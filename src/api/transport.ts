/**
 * HTTP mechanics shared by the app's two clients (worker-app design DD16): `AppClient` (device
 * envelope, `/api/v1/hr/attendance-app/**`) and `AccountClient` (Bearer token, `/api/v1/hr/worker/**`
 * and `/api/v1/auth/*`). The transport knows nothing about either credential: it is given the
 * headers to send and turns the answer into a value or one of three errors.
 *
 * Rules (HR design R6.1, ER2; worker-app R9.3):
 *
 * - HTTPS only (HR R9.7): {@link parseHttpsBase} refuses a base URL that is not `https://`.
 *   Certificate trust is the operating system's: a TLS failure surfaces from `fetch` as a
 *   connection error, so no request is sent and the caller keeps its queue.
 * - "Not reachable": no answer within the timeout, a connection or TLS error, a 5xx, or an answer
 *   that is not the API envelope. Thrown as {@link NotReachable}; the offline queue retries these.
 * - A refusal is an answer, not "not reachable": a 4xx carrying the API error envelope. Thrown as
 *   {@link ServerRefusal} with the server's `data.message` word for word and, where it can be
 *   told, the `ErrorCode` name.
 * - "Not authenticated": a 401 carrying the API error envelope. Thrown as {@link NotAuthenticated}.
 *   Only the Bearer paths ever answer 401 (the device interceptor answers 403 for a lost pairing
 *   and 422 for a bad signature), so `AppClient` never sees it; `AccountClient`'s callers treat it
 *   as "sign in again, keep everything else" (R9.3), in one place (`useAppState`).
 *
 * Every response may carry `X-Server-Time`; the transport reports it through `onServerTime` and
 * does nothing else with it. `AppClient` keeps the offset for envelope timestamps only.
 *
 * Pure: no Expo or React Native import. `fetch` is injected so tests and the phone can differ.
 */
import { SERVER_MESSAGES, refusalText } from '@stockkart/attendance-protocol';
import type { AppErrorCode, WorkerErrorCode } from '@stockkart/attendance-protocol';
import type { ApiResponse } from './apiResponse';

/** `fetch` as the clients use it; injected so tests and the phone can differ. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * A request body: JSON text (sent byte for byte, with `Content-Type: application/json`) or a
 * `FormData` for the one multipart call (`PUT /users/me/photo`), whose content type and boundary
 * `fetch` sets itself.
 */
export type TransportBody = string | FormData;

/**
 * `ErrorCode` names the Bearer paths produce that are neither device-path (`AppErrorCode`) nor
 * worker-path (`WorkerErrorCode`) codes: the authentication and access answers of `/auth/*`,
 * `/users/me/*` and the module check, plus `HR_NOT_LINKED` from `/hr/me/**`.
 * `OAUTH_ACCOUNT_NOT_FOUND` (4004) is `/auth/login`'s answer when Google verified the token but no
 * Stockkart account exists for it (R1.10, DD20): the Sign in screen turns it into the phone step.
 */
export type AccountErrorCode =
  | 'ACCESS_DENIED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'OAUTH_ACCOUNT_NOT_FOUND'
  | 'USER_ALREADY_EXISTS'
  | 'HR_NOT_LINKED';

/** Every `ErrorCode` name a {@link ServerRefusal} can carry, from either client. */
export type RefusalCode = AppErrorCode | WorkerErrorCode | AccountErrorCode;

/** Header the server puts on every answer: its clock in epoch seconds. */
export const HEADER_SERVER_TIME = 'X-Server-Time';

/** R6.1: the server counts as not reachable after this long without an answer. */
export const DEFAULT_TIMEOUT_MS = 10_000;

// --- outcomes ---

/** Why the server counted as not reachable (R6.1). */
export type NotReachableReason =
  /** No answer within the timeout. */
  | 'TIMEOUT'
  /** `fetch` rejected: no network, DNS, TLS not trusted, connection reset. */
  | 'CONNECTION'
  /** A 5xx response: the server answered but not with a result; retried like a timeout. */
  | 'SERVER_ERROR'
  /** A response that is not the API envelope (a proxy page, truncated JSON). */
  | 'BAD_ANSWER';

/** The server was not reachable (R6.1). The caller keeps its queue and retries later. */
export class NotReachable extends Error {
  readonly kind = 'not_reachable' as const;
  readonly reason: NotReachableReason;
  readonly status: number | undefined;

  constructor(reason: NotReachableReason, status?: number, cause?: unknown) {
    super(`server not reachable (${reason}${status ? ` ${status}` : ''})`);
    this.name = 'NotReachable';
    this.reason = reason;
    this.status = status;
    this.cause = cause;
  }
}

/**
 * The server answered with a refusal (a 4xx other than 401 carrying the API error envelope).
 * `message` is what the app shows: the server's text word for word, with the R7.10 line added for
 * `HR_APP_NOT_PAIRED` (`refusalText`). `code` is the `ErrorCode` name when it can be told from
 * the text or status (the envelope itself carries no code name); `serverMessage` is the raw text.
 * The inference defaults to the device-path rules of {@link inferErrorCode}; a client whose paths
 * produce other codes passes its own through {@link TransportDeps.inferCode} (`AccountClient`
 * passes `inferAccountErrorCode`, where a 403 is `ACCESS_DENIED`, never "not paired").
 */
export class ServerRefusal extends Error {
  readonly kind = 'refusal' as const;
  readonly status: number;
  readonly code: RefusalCode | undefined;
  readonly serverMessage: string;

  constructor(
    status: number,
    serverMessage: string,
    infer: (status: number, message: string) => RefusalCode | undefined = inferErrorCode,
  ) {
    const code = infer(status, serverMessage);
    super(refusalText(code ?? '', serverMessage));
    this.name = 'ServerRefusal';
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
  }

  /** R3.2–R3.3: the pairing is gone; the app must wipe and show the pairing screen. */
  get notPaired(): boolean {
    return this.code === 'HR_APP_NOT_PAIRED';
  }
}

/**
 * The server answered 401 with the API error envelope: the session token is missing, expired or
 * revoked (worker-app R9.3). The caller clears the token and asks for a sign-in; the pairing, the
 * offline queue and the last known state are kept. `message` is the server's text word for word.
 */
export class NotAuthenticated extends Error {
  readonly kind = 'not_authenticated' as const;
  readonly status = 401 as const;
  readonly serverMessage: string;

  constructor(serverMessage: string) {
    super(serverMessage);
    this.name = 'NotAuthenticated';
    this.serverMessage = serverMessage;
  }
}

export function isNotReachable(error: unknown): error is NotReachable {
  return error instanceof NotReachable;
}

export function isServerRefusal(error: unknown): error is ServerRefusal {
  return error instanceof ServerRefusal;
}

export function isNotAuthenticated(error: unknown): error is NotAuthenticated {
  return error instanceof NotAuthenticated;
}

// --- transport ---

export interface TransportDeps {
  /** Defaults to the runtime's `fetch`; throws at construction when there is none. */
  fetch?: FetchLike;
  /** Called with the server clock in epoch seconds whenever an answer carries a valid header. */
  onServerTime?: (serverSeconds: number) => void;
  /** Maps a refusal to its `ErrorCode` name; defaults to the device-path rules of `inferErrorCode`. */
  inferCode?: (status: number, message: string) => RefusalCode | undefined;
}

export interface Transport {
  /**
   * One HTTP call. `headers` are sent as given plus `Accept: application/json` and, when `body`
   * is JSON text, `Content-Type: application/json`; a text body is sent byte for byte (signed
   * envelopes depend on the bytes not changing) and a `FormData` body is left to `fetch`, which
   * sets the multipart content type and boundary. Resolves with the envelope's `data`, or throws
   * {@link NotReachable}, {@link NotAuthenticated} or {@link ServerRefusal}. Never retries: a
   * caller that may have created something on the server reads the state again instead.
   */
  send<T>(
    method: HttpMethod,
    url: string,
    headers: Record<string, string>,
    body: TransportBody | undefined,
    timeoutMs: number,
  ): Promise<T>;
}

export function createTransport(deps: TransportDeps = {}): Transport {
  const fetchImpl = deps.fetch ?? defaultFetch();
  const onServerTime = deps.onServerTime;
  const inferCode = deps.inferCode ?? inferErrorCode;

  return {
    async send<T>(
      method: HttpMethod,
      url: string,
      headers: Record<string, string>,
      body: TransportBody | undefined,
      timeoutMs: number,
    ): Promise<T> {
      const sent: Record<string, string> = { Accept: 'application/json', ...headers };
      if (typeof body === 'string') {
        sent['Content-Type'] = 'application/json';
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, { method, headers: sent, body, signal: controller.signal });
      } catch (error) {
        throw new NotReachable(isAbort(error) ? 'TIMEOUT' : 'CONNECTION', undefined, error);
      } finally {
        clearTimeout(timer);
      }

      if (onServerTime) {
        const serverSeconds = readServerTime(response);
        if (serverSeconds !== undefined) {
          onServerTime(serverSeconds);
        }
      }

      if (response.status >= 500) {
        throw new NotReachable('SERVER_ERROR', response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new NotReachable('BAD_ANSWER', response.status, error);
      }

      if (response.ok) {
        if (!isEnvelope(payload) || payload.success !== true) {
          throw new NotReachable('BAD_ANSWER', response.status);
        }
        return payload.data as T;
      }

      const message = errorMessage(payload);
      if (message == null) {
        throw new NotReachable('BAD_ANSWER', response.status);
      }
      if (response.status === 401) {
        throw new NotAuthenticated(message);
      }
      throw new ServerRefusal(response.status, message, inferCode);
    },
  };
}

// --- helpers ---

const HTTPS_BASE = /^https:\/\/([^\s/?#]+)(\/[^\s?#]*)?$/;

/** Splits `https://host[:port][/base]` into origin and base path; refuses anything else (R9.7). */
export function parseHttpsBase(baseUrl: string): { origin: string; basePath: string } {
  const match = HTTPS_BASE.exec((baseUrl ?? '').trim());
  if (!match) {
    throw new Error(
      `The Attendance app only talks to an https:// API URL without query or fragment, got ${JSON.stringify(
        baseUrl,
      )}.`,
    );
  }
  return { origin: `https://${match[1]}`, basePath: (match[2] ?? '').replace(/\/+$/, '') };
}

/**
 * The `ErrorCode` name behind a device-path refusal, when it can be told. The API error envelope
 * carries the text and the HTTP status but no code name, so: exact text match first
 * (`SERVER_MESSAGES`), the one templated text next, then the statuses only one code produces on
 * `/attendance-app/**` (403 is `HR_APP_NOT_PAIRED`; 429 without a matching text is
 * `HR_TOO_MANY_ATTEMPTS`). Not for the Bearer paths, where 403 is `ACCESS_DENIED`.
 */
export function inferErrorCode(status: number, message: string): AppErrorCode | undefined {
  const text = message.trim();
  for (const [code, known] of Object.entries(SERVER_MESSAGES) as [AppErrorCode, string][]) {
    if (known === text) {
      return code;
    }
  }
  if (text.startsWith('Too many wrong codes.')) {
    return 'HR_PAIRING_CODE_LOCKED';
  }
  if (status === 403) {
    return 'HR_APP_NOT_PAIRED';
  }
  if (status === 429) {
    return 'HR_TOO_MANY_ATTEMPTS';
  }
  return undefined;
}

/** The `X-Server-Time` header as epoch seconds, or undefined when absent or not a safe integer. */
export function readServerTime(response: Response): number | undefined {
  const header = response.headers.get(HEADER_SERVER_TIME);
  if (header == null) {
    return undefined;
  }
  const serverSeconds = Number(header.trim());
  return Number.isSafeInteger(serverSeconds) ? serverSeconds : undefined;
}

function isEnvelope(value: unknown): value is ApiResponse<unknown> {
  return typeof value === 'object' && value !== null && 'success' in value;
}

/** `data.message`, then `error`, then `message` (the shared web client's order); null when none. */
function errorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const p = payload as { data?: unknown; error?: unknown; message?: unknown };
  const data = p.data as { message?: unknown } | undefined;
  for (const candidate of [data?.message, p.error, p.message]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!f) {
    throw new Error('fetch is not available on this runtime; pass one in the client deps');
  }
  return (input, init) => f(input, init);
}
