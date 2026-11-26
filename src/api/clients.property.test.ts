// Task 13.7 — Property 21, client half (The two credentials never travel together; R7.6, R9.1):
// for any sequence of calls across the app's clients — `AccountClient` (Bearer token), `AppClient`
// (device envelope) and `WorkerPairingClient` (the pairing handshake through `AccountClient`) — with
// the token and the pairing present or absent at the moment of each call, every request that
// reaches `fetch` carries either `Authorization` or the four envelope headers, never both, and the
// path family alone decides which:
//
// - `/hr/worker/**`, `/users/me/**` and `/auth/logout` carry `Authorization: Bearer <token>` and
//   none of `X-Pairing-Id`, `X-Request-Timestamp`, `X-Request-Nonce`, `X-Request-Signature`;
// - `/hr/attendance-app/**` never carries `Authorization`; the signed calls carry all four
//   envelope headers, the one unsigned call (`consent/latest`) carries none; `AppClient` has no
//   pairing handshake (D11, DD4: a code is redeemed on `/hr/worker/pairings/*` only);
// - `/auth/login` and `/auth/signup` carry no credential at all;
// - a session call with no token stored, and a signed call with no pairing, send nothing and
//   reject with `NoSession` / `NoPairing`.
//
// The server half of Property 21 (`HR_TWO_CREDENTIALS`) is tested on the backend. The expected
// request count, credential and path family per call are written out here independently of the
// clients' route tables, so the implementation cannot vouch for itself.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AccountClient, NoSession, type AuthResponse } from './accountClient';
import { AppClient, NoPairing, type RequestSigner } from './appClient';
import type { FetchLike } from './transport';
import { WorkerPairingClient } from '../pairing/WorkerPairingClient';

const NUM_RUNS = 150;
const BASE = 'https://api.example.in/api/v1';

// ---------------------------------------------------------------------------------------------
// Recording fetch
// ---------------------------------------------------------------------------------------------

interface Recorded {
  method: string;
  url: string;
  /** Header names lower-cased, so the check is case-insensitive. */
  headers: Record<string, string>;
}

const AUTH_ANSWER: AuthResponse = {
  accessToken: 'tok-from-server',
  user: {
    userId: '66f1a2b3c4d5e6f708192a3b',
    role: 'WORKER',
    email: 'priya@example.in',
    name: 'Priya Sharma',
  },
};

/** Answers every request with a success envelope; sign-in and sign-up get a valid auth answer. */
function recordingFetch(): { fetch: FetchLike; recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const fetch: FetchLike = (url, init) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(init.headers as Record<string, string>)) {
      headers[name.toLowerCase()] = value;
    }
    recorded.push({ method: init.method ?? 'GET', url, headers });
    const path = url.slice(BASE.length);
    const data = path === '/auth/login' || path === '/auth/signup' ? AUTH_ANSWER : {};
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return { fetch, recorded };
}

// ---------------------------------------------------------------------------------------------
// Harness: the three clients over one fetch, credentials read at the moment of each call
// ---------------------------------------------------------------------------------------------

interface Harness {
  token: string | null;
  pairingId: string | null;
  account: AccountClient;
  app: AppClient;
  workerPairing: WorkerPairingClient;
  recorded: Recorded[];
}

/** A device-key stand-in: the property is about which headers travel, not their bytes. */
const signer: RequestSigner = { signRequest: async () => 'c2lnbmVk' };

function harness(): Harness {
  const { fetch, recorded } = recordingFetch();
  const h: Harness = {
    token: null,
    pairingId: null,
    recorded,
    account: null as unknown as AccountClient,
    app: null as unknown as AppClient,
    workerPairing: null as unknown as WorkerPairingClient,
  };
  h.account = new AccountClient({
    baseUrl: BASE,
    tokens: { accessToken: async () => h.token },
    fetch,
    timeoutMs: 1000,
  });
  h.app = new AppClient({
    baseUrl: BASE,
    signer,
    pairingId: async () => h.pairingId,
    fetch,
    timeoutMs: 1000,
  });
  h.workerPairing = new WorkerPairingClient(h.account);
  return h;
}

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

type ClientName = 'account' | 'app' | 'workerPairing';

/** How a call identifies itself, as the design states it (R9.1), independent of the route tables. */
type Credential =
  /** `/auth/login`, `/auth/signup`: nothing. */
  | 'none'
  /** `AccountClient` session calls, incl. the Bearer pairing handshake: `Authorization` only. */
  | 'bearer'
  /** `AppClient` latest consent: no header, device path. */
  | 'unsigned-device'
  /** `AppClient` signed calls: the four envelope headers only. */
  | 'envelope';

interface Op {
  client: ClientName;
  method: string;
  args: readonly unknown[];
  credential: Credential;
}

const hexId = fc.hexaString({ minLength: 24, maxLength: 24 });
const uuid = fc.uuid({ version: 4 }).map((u) => u.toLowerCase());
const words = fc.stringMatching(/^[A-Za-z][A-Za-z .'-]{0,29}$/);
const email = words.map((w) => `${w.replace(/[^A-Za-z]/g, '').toLowerCase() || 'w'}@example.in`);
const phone = fc.stringMatching(/^[6-9][0-9]{9}$/);
const isoDate = fc
  .integer({ min: Date.UTC(2025, 0, 1) / 1000, max: Date.UTC(2025, 11, 31) / 1000 })
  .map((s) => new Date(s * 1000).toISOString().slice(0, 10));
const code = fc.stringMatching(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
const base64 = fc.stringMatching(/^[A-Za-z0-9+/]{16,64}$/);

const claimRequest = fc.record({
  code,
  installationId: uuid,
  os: fc.constantFrom('ANDROID', 'IOS'),
  osVersion: fc.stringMatching(/^[0-9]{1,2}(\.[0-9]{1,2})?$/),
  phoneModel: words,
  appVersion: fc.stringMatching(/^[0-9]\.[0-9]\.[0-9]$/),
});
const completeRequest = fc.record({
  claimToken: base64,
  installationId: uuid,
  punchPublicKey: base64,
  devicePublicKey: base64,
  consentVersion: fc.integer({ min: 1, max: 9 }),
});
const abandonRequest = fc.record({ claimToken: base64 });
const punchRequest = fc.record({
  pairingId: hexId,
  shopId: hexId,
  employeeId: hexId,
  punchId: uuid,
  phoneTime: isoDate.map((d) => `${d}T09:12:00Z`),
  offline: fc.boolean(),
  locationChecked: fc.boolean(),
  distanceMetres: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
  accuracyMetres: fc.option(fc.integer({ min: 1, max: 500 }), { nil: null }),
  mock: fc.boolean(),
  signature: base64,
});
const dateRange = fc
  .tuple(isoDate, isoDate)
  .map(([a, b]) => (a <= b ? ([a, b] as const) : ([b, a] as const)));
const photoUpload = fc.record({
  blob: fc
    .array(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 64 })
    .map((bytes) => new Blob([new Uint8Array(bytes)])),
  contentType: fc.constantFrom('image/jpeg', 'image/png'),
});

function op(
  client: ClientName,
  method: string,
  credential: Credential,
  args: fc.Arbitrary<readonly unknown[]> = fc.constant([]),
): fc.Arbitrary<Op> {
  return args.map((a) => ({ client, method, args: a, credential }));
}

/** Every method of the three clients that sends a request, with arguments it accepts. */
const anyOp: fc.Arbitrary<Op> = fc.oneof(
  // AccountClient: sign-in and sign-up, no credential (R1.6)
  op('account', 'signIn', 'none', fc.tuple(fc.record({ email, password: words }))),
  op('account', 'signInWithGoogle', 'none', fc.tuple(base64)),
  op(
    'account',
    'createAccount',
    'none',
    fc.tuple(fc.record({ name: words, email, password: words, phone })),
  ),
  op('account', 'createAccountWithGoogle', 'none', fc.tuple(fc.record({ idToken: base64, phone }))),
  // AccountClient: session calls, Bearer only (R9.1)
  op('account', 'logout', 'bearer'),
  op('account', 'workerState', 'bearer'),
  op('account', 'lookupShops', 'bearer', fc.tuple(email)),
  op('account', 'createJoinRequest', 'bearer', fc.tuple(hexId)),
  op('account', 'withdraw', 'bearer', fc.tuple(hexId)),
  op('account', 'claim', 'bearer', fc.tuple(claimRequest)),
  op('account', 'complete', 'bearer', fc.tuple(completeRequest)),
  op('account', 'abandon', 'bearer', fc.tuple(abandonRequest)),
  op('account', 'history', 'bearer', dateRange),
  op('account', 'profile', 'bearer'),
  op('account', 'updateProfile', 'bearer', fc.tuple(fc.record({ name: words, phone }))),
  op('account', 'uploadPhoto', 'bearer', fc.tuple(photoUpload)),
  op('account', 'deletePhoto', 'bearer'),
  op('account', 'leaveShop', 'bearer'),
  op('account', 'notifications', 'bearer'),
  op('account', 'markRead', 'bearer', fc.tuple(hexId)),
  // WorkerPairingClient: the handshake with a login, Bearer only (R7.2, DD4)
  op('workerPairing', 'claim', 'bearer', fc.tuple(claimRequest)),
  op('workerPairing', 'complete', 'bearer', fc.tuple(completeRequest)),
  op('workerPairing', 'abandon', 'bearer', fc.tuple(abandonRequest)),
  // AppClient: the consent text, the one unsigned device call
  op('app', 'getLatestConsent', 'unsigned-device'),
  // AppClient: signed calls, envelope only (R7.6)
  op('app', 'getMe', 'envelope'),
  op('app', 'postPunch', 'envelope', fc.tuple(punchRequest)),
  op('app', 'getPunches', 'envelope', dateRange),
  op('app', 'postConsent', 'envelope', fc.tuple(fc.integer({ min: 1, max: 9 }))),
  op('app', 'unpairMe', 'envelope'),
);

/** A Bearer token as stored: present, or absent as `null` or the empty string (both mean none). */
const storedToken = fc.oneof(
  { weight: 3, arbitrary: fc.stringMatching(/^[A-Za-z0-9._-]{8,60}$/) },
  { weight: 1, arbitrary: fc.constantFrom<string | null>(null, '') },
);
const storedPairingId = fc.option(hexId, { nil: null });

interface Step {
  op: Op;
  token: string | null;
  pairingId: string | null;
}

const step: fc.Arbitrary<Step> = fc.record({
  op: anyOp,
  token: storedToken,
  pairingId: storedPairingId,
});
const steps = fc.array(step, { minLength: 1, maxLength: 25 });

// ---------------------------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------------------------

const ENVELOPE = ['x-pairing-id', 'x-request-timestamp', 'x-request-nonce', 'x-request-signature'];

type Family = 'bearer' | 'device' | 'open';

/** The path family, as R9.1 lists it; written out independently of `ACCOUNT_ROUTES` / `ROUTES`. */
function familyOf(url: string): Family {
  const path = url.startsWith(BASE) ? url.slice(BASE.length) : '';
  if (path.startsWith('/hr/attendance-app/')) return 'device';
  if (path.startsWith('/hr/worker/') || path.startsWith('/users/me/') || path === '/auth/logout') {
    return 'bearer';
  }
  if (path === '/auth/login' || path === '/auth/signup') return 'open';
  throw new Error(`request to an unknown path family: ${url}`);
}

/** The one device route that goes without an envelope (the consent text is public). */
const UNSIGNED_DEVICE_PATHS = ['/hr/attendance-app/consent/latest'];

function hasToken(token: string | null): boolean {
  return token != null && token.length > 0;
}

/** How many requests a step must produce: one, or none when its credential is missing. */
function expectedRequests(s: Step): number {
  switch (s.op.credential) {
    case 'none':
    case 'unsigned-device':
      return 1;
    case 'bearer':
      return hasToken(s.token) ? 1 : 0;
    case 'envelope':
      return s.pairingId != null ? 1 : 0;
  }
}

function envelopeHeadersOn(headers: Record<string, string>): string[] {
  return ENVELOPE.filter((name) => name in headers);
}

async function run(h: Harness, s: Step): Promise<{ sent: Recorded[]; error: unknown }> {
  h.token = s.token;
  h.pairingId = s.pairingId;
  const before = h.recorded.length;
  const target = h[s.op.client] as unknown as Record<
    string,
    (...args: readonly unknown[]) => Promise<unknown>
  >;
  let error: unknown = undefined;
  try {
    await target[s.op.method](...s.op.args);
  } catch (e) {
    error = e;
  }
  return { sent: h.recorded.slice(before), error };
}

// ---------------------------------------------------------------------------------------------
// Property 21 (client half)
// ---------------------------------------------------------------------------------------------

describe('Feature: worker-app, Property 21: The two credentials never travel together (client half)', () => {
  it('for any sequence of calls across AccountClient, AppClient and WorkerPairingClient, every request carries Authorization or the envelope, never both, and the path family decides which (R7.6, R9.1)', async () => {
    await fc.assert(
      fc.asyncProperty(steps, async (sequence) => {
        const h = harness();
        for (const s of sequence) {
          const { sent } = await run(h, s);
          for (const request of sent) {
            const authorization = request.headers['authorization'];
            const envelope = envelopeHeadersOn(request.headers);

            // Never both, whatever the path.
            expect(authorization !== undefined && envelope.length > 0).toBe(false);

            switch (familyOf(request.url)) {
              case 'bearer':
                expect(authorization).toBe(`Bearer ${s.token}`);
                expect(envelope).toEqual([]);
                break;
              case 'device': {
                expect(authorization).toBeUndefined();
                const path = request.url.slice(BASE.length).split('?')[0];
                if (UNSIGNED_DEVICE_PATHS.includes(path)) {
                  expect(envelope).toEqual([]);
                } else {
                  expect(envelope).toEqual(ENVELOPE);
                  expect(request.headers['x-pairing-id']).toBe(s.pairingId);
                }
                break;
              }
              case 'open':
                expect(authorization).toBeUndefined();
                expect(envelope).toEqual([]);
                break;
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any sequence of calls, each client stays on its own path family: AccountClient and WorkerPairingClient never reach /hr/attendance-app/**, AppClient reaches nothing else (R9.1)', async () => {
    await fc.assert(
      fc.asyncProperty(steps, async (sequence) => {
        const h = harness();
        for (const s of sequence) {
          const { sent } = await run(h, s);
          for (const request of sent) {
            const family = familyOf(request.url);
            if (s.op.client === 'app') {
              expect(family).toBe('device');
            } else {
              expect(family).not.toBe('device');
            }
            if (s.op.client === 'workerPairing') {
              expect(request.url.startsWith(`${BASE}/hr/worker/pairings/`)).toBe(true);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any sequence of calls, a call whose credential is missing sends nothing and rejects with NoSession or NoPairing; every other call sends exactly one request (R9.1)', async () => {
    await fc.assert(
      fc.asyncProperty(steps, async (sequence) => {
        const h = harness();
        for (const s of sequence) {
          const { sent, error } = await run(h, s);
          expect(sent).toHaveLength(expectedRequests(s));
          if (sent.length === 0) {
            if (s.op.credential === 'bearer') {
              expect(error).toBeInstanceOf(NoSession);
            } else {
              expect(error).toBeInstanceOf(NoPairing);
            }
          } else {
            expect(error).toBeUndefined();
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
