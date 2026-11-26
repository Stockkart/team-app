/**
 * The Attendance app's HTTP client for `/api/v1/hr/attendance-app/**` (design "Attendance app"
 * table, `appClient`). Plain `fetch`, no axios, no `localStorage`, no Bearer token: identity is
 * the pairing, proved by a signed request envelope (R9.8).
 *
 * Transport rules (HTTPS only, R9.7; "not reachable" after 10 s, a connection error, a 5xx or a
 * non-envelope answer, R6.1; a 4xx with the error envelope is a {@link ServerRefusal} carrying
 * `data.message` word for word, ER2) live in `./transport.ts`, which this client shares with the
 * worker-app `AccountClient` (worker-app DD16). The two never mix credentials: this client puts
 * the four envelope headers on signed calls and never an `Authorization` header (worker-app R9.1).
 *
 * Envelope (design "Canonical payloads", server `AttendanceAppAuthInterceptor`): every signed call
 * carries `X-Pairing-Id`, `X-Request-Timestamp` (epoch seconds, within ±10 min of server time),
 * `X-Request-Nonce` (UUID v4) and `X-Request-Signature` (Base64 DER ECDSA by the device key) over
 * `canonicalRequestEnvelope(method, path, raw query, timestamp, nonce, exact body bytes)`. The
 * `path` is the request URI the server sees, so the base URL's own path (`/api/v1`) is part of it.
 * Every response carries `X-Server-Time`; the client keeps the offset to the phone's clock and
 * applies it to envelope timestamps only, never to punch times (R4.4, R6.9).
 *
 * The latest-consent read is the one unsigned call (the consent text holds no shop data), matching
 * `AttendanceAppAuthInterceptor.UNSIGNED_PATHS`. There is no unsigned pairing handshake any more
 * (worker-app D11, DD4): a pairing code is redeemed only through `AccountClient` and
 * `WorkerPairingClient` on `/hr/worker/pairings/*` with the Bearer token (worker-app R7.2).
 *
 * Pure: no Expo or React Native import. The composition root passes `fetch`, the signer, the
 * pairing id source and (on the phone) `expo-crypto` digests through {@link AppClientDeps}; see
 * `./expoCrypto.ts`.
 */
import { canonicalRequestEnvelope } from '@stockkart/attendance-protocol';
import type {
  AppPunchRequest,
  AppPunchResponse,
  AppStatusResponse,
  ConsentResponse,
  ConsentVersion,
  PunchResponse,
  Sha256,
  UnpairResponse,
} from '@stockkart/attendance-protocol';

import {
  DEFAULT_TIMEOUT_MS,
  createTransport,
  parseHttpsBase,
  type FetchLike,
  type Transport,
} from './transport';

// The outcomes and helpers moved to `./transport.ts`; re-exported so importers need not change.
export {
  DEFAULT_TIMEOUT_MS,
  HEADER_SERVER_TIME,
  NotAuthenticated,
  NotReachable,
  ServerRefusal,
  inferErrorCode,
  isNotAuthenticated,
  isNotReachable,
  isServerRefusal,
  parseHttpsBase,
  type AccountErrorCode,
  type FetchLike,
  type NotReachableReason,
  type RefusalCode,
} from './transport';

/**
 * The part of `BiometricSigner` (`src/signer/BiometricSigner.ts`, task 12.2) this client needs:
 * the device key, no biometric prompt. `BiometricSigner.signRequest` resolves with the DER
 * signature bytes; the client Base64-encodes them for the header. A signer that already returns
 * Base64 text is accepted too. Declared structurally so `BiometricSigner` satisfies it as is and
 * tests can pass a WebCrypto stand-in.
 */
export interface RequestSigner {
  /** DER `ECDSA-Sig-Value` over `bytes` (or its Base64 text), made with the device key. */
  signRequest(bytes: Uint8Array): Promise<Uint8Array | string>;
}

export interface AppClientDeps {
  /** `https://host[/base-path]`, e.g. `https://api.example.in/api/v1`. Anything else throws. */
  baseUrl: string;
  signer: RequestSigner;
  /** The current pairing id, or null when not paired (then a signed call throws {@link NoPairing}). */
  pairingId: () => Promise<string | null>;
  fetch?: FetchLike;
  /** SHA-256 for the envelope's `bodySha256`; defaults to `crypto.subtle` when the runtime has it. */
  sha256?: Sha256;
  /** Nonce source; defaults to `crypto.randomUUID` when the runtime has it. */
  randomUUID?: () => string;
  /** Phone clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** R6.1: "no answer" after this many milliseconds. */
  timeoutMs?: number;
}

/** Header names, identical to `AttendanceAppAuthInterceptor`. */
export const HEADER_PAIRING_ID = 'X-Pairing-Id';
export const HEADER_TIMESTAMP = 'X-Request-Timestamp';
export const HEADER_NONCE = 'X-Request-Nonce';
export const HEADER_SIGNATURE = 'X-Request-Signature';

/** Routes under the base URL; the full request path is `basePath + route`. */
export const ROUTES = {
  latestConsent: '/hr/attendance-app/consent/latest',
  me: '/hr/attendance-app/me',
  punches: '/hr/attendance-app/punches',
  consent: '/hr/attendance-app/consent',
  unpairMe: '/hr/attendance-app/pairings/me/unpair',
} as const;

// --- outcomes ---
// `NotReachable`, `ServerRefusal` and `NotAuthenticated` are defined in `./transport.ts` and
// re-exported above. `NoPairing` is this client's own: nothing was sent.

/** A signed call was attempted while the phone is not paired. Nothing was sent. */
export class NoPairing extends Error {
  readonly kind = 'no_pairing' as const;

  constructor() {
    super('this phone is not paired');
    this.name = 'NoPairing';
  }
}

// --- client ---

export class AppClient {
  private readonly origin: string;
  private readonly basePath: string;
  private readonly transport: Transport;
  private readonly signer: RequestSigner;
  private readonly pairingId: () => Promise<string | null>;
  private readonly sha256: Sha256 | undefined;
  private readonly randomUUID: () => string;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  /** Server clock minus phone clock, whole seconds, from the last `X-Server-Time` seen. */
  private offsetSeconds = 0;
  private offsetKnown = false;

  constructor(deps: AppClientDeps) {
    const base = parseHttpsBase(deps.baseUrl);
    this.origin = base.origin;
    this.basePath = base.basePath;
    this.transport = createTransport({
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      onServerTime: (serverSeconds) => this.applyServerTime(serverSeconds),
    });
    this.signer = deps.signer;
    this.pairingId = deps.pairingId;
    this.sha256 = deps.sha256;
    this.randomUUID = deps.randomUUID ?? defaultRandomUUID;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Server clock minus phone clock in seconds; 0 until the first answer. Envelope use only. */
  get serverOffsetSeconds(): number {
    return this.offsetSeconds;
  }

  /** True once an `X-Server-Time` header has been seen. */
  get hasServerTime(): boolean {
    return this.offsetKnown;
  }

  /** The phone's clock corrected by the server offset, in epoch seconds. */
  serverNowSeconds(): number {
    return Math.floor(this.now() / 1000) + this.offsetSeconds;
  }

  // ---- unsigned call ----

  /** The newest consent text (R9.12); no shop data, no signature. */
  getLatestConsent(): Promise<ConsentVersion> {
    return this.unsigned<ConsentVersion>('GET', ROUTES.latestConsent);
  }

  // ---- signed calls ----

  /** The home screen's data (R4.1). */
  getMe(): Promise<AppStatusResponse> {
    return this.signed<AppStatusResponse>('GET', ROUTES.me);
  }

  /** One punch, online or queued (R4.2c, R6.5). */
  postPunch(request: AppPunchRequest): Promise<AppPunchResponse> {
    return this.signed<AppPunchResponse>('POST', ROUTES.punches, { body: request });
  }

  /** The worker's own punches with a day in `[from, to]`, both `yyyy-MM-dd` (R4.10). */
  async getPunches(from: string, to: string): Promise<PunchResponse[]> {
    requireDate(from, 'from');
    requireDate(to, 'to');
    const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return this.signed<PunchResponse[]>('GET', ROUTES.punches, { query });
  }

  /** "I agree" on a newer consent version (R9.13). */
  postConsent(version: number): Promise<ConsentResponse> {
    return this.signed<ConsentResponse>('POST', ROUTES.consent, { body: { version } });
  }

  /** "Remove this phone" (R3.7). Needs the server; a {@link NotReachable} means still paired. */
  unpairMe(): Promise<UnpairResponse> {
    return this.signed<UnpairResponse>('POST', ROUTES.unpairMe);
  }

  // ---- transport ----

  private async unsigned<T>(method: 'GET', route: string): Promise<T> {
    return this.send<T>(method, this.basePath + route, '', undefined, {});
  }

  private async signed<T>(
    method: 'GET' | 'POST',
    route: string,
    options: { query?: string; body?: unknown } = {},
  ): Promise<T> {
    const pairingId = await this.pairingId();
    if (pairingId == null) {
      throw new NoPairing();
    }
    const path = this.basePath + route;
    const query = options.query ?? '';
    const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);
    const timestamp = this.serverNowSeconds();
    const nonce = this.randomUUID().toLowerCase();
    const envelope = await canonicalRequestEnvelope(
      { pairingId, method, path, query, timestamp, nonce, body: bodyText },
      this.sha256 ? { sha256: this.sha256 } : {},
    );
    // The signer's own errors (KEY_INVALIDATED, NO_KEYS and the like) pass through untouched.
    const signed = await this.signer.signRequest(envelope);
    const signature = typeof signed === 'string' ? signed : bytesToBase64(signed);
    return this.send<T>(method, path, query, bodyText, {
      [HEADER_PAIRING_ID]: pairingId,
      [HEADER_TIMESTAMP]: String(timestamp),
      [HEADER_NONCE]: nonce,
      [HEADER_SIGNATURE]: signature,
    });
  }

  private send<T>(
    method: 'GET' | 'POST',
    path: string,
    query: string,
    bodyText: string | undefined,
    headers: Record<string, string>,
  ): Promise<T> {
    const url = `${this.origin}${path}${query ? `?${query}` : ''}`;
    return this.transport.send<T>(method, url, headers, bodyText, this.timeoutMs);
  }

  private applyServerTime(serverSeconds: number): void {
    this.offsetSeconds = serverSeconds - Math.floor(this.now() / 1000);
    this.offsetKnown = true;
  }
}

// --- helpers ---

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(value: string, field: string): void {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new Error(`${field} must be yyyy-MM-dd`);
  }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Standard Base64 with padding, as `java.util.Base64.getDecoder()` reads it. Written out rather
 * than taken from `btoa`/`Buffer` so it runs the same on Hermes and node.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64[triple & 63] : '=';
  }
  return out;
}

function defaultRandomUUID(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!c?.randomUUID) {
    throw new Error(
      'crypto.randomUUID is not available on this runtime; pass one in AppClientDeps',
    );
  }
  return c.randomUUID();
}
