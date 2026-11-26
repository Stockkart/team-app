// Task 14.7 — Property 23 (Signing in with a different account unpairs, whatever the network does;
// R9.7), run against the real `switchAccount` with the real `AppClient` over a fake `fetch`, the
// real `PairingStore` over an in-memory `SecureStorage`, and the real `PunchQueue` over
// `MemoryDatabase`, the way `src/app/deps.ts` wires them on the phone.
//
// For any stored pairing, queue length `n` (waiting and refused rows), reachability (an OK, a
// "not paired" 403, another refusal, a connection error, a 5xx, a non-envelope answer, a timeout)
// and the worker's decision: `switchAccount` asks once with a warning that names `n` ("1 punch
// that was not yet sent will be lost", "N punches …", nothing when `n = 0`); on confirm it sends
// `POST /hr/attendance-app/pairings/me/unpair` exactly once, signed with the device key and
// carrying no `Authorization`, and afterwards the pairing record, the installation id, the keys,
// the queue and `pairingOwnerUserId` are gone whatever the server said; on cancel nothing is sent
// and nothing changes. A second property drives the same through `completeSignIn`, which decides
// by `pairingOwnerUserId !== userId` alone (no server call): a cancel stores nothing of the new
// account and does not re-resolve, a confirm stores it after the wipe, the same owner is never
// asked and never unpairs (R9.6), and a pairing with no recorded owner is treated as another
// account's and asked.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { SERVER_MESSAGES } from '@stockkart/attendance-protocol';
import type { AppLocationSettings, AppPunchRequest } from '@stockkart/attendance-protocol';

import {
  AppClient,
  HEADER_NONCE,
  HEADER_PAIRING_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  ROUTES,
  type FetchLike,
  type RequestSigner,
} from '../api/appClient';
import type { ConfirmPrompt } from '../app/useAppState';
import { STRINGS_EN } from '../i18n';
import { PUNCH_QUEUE_TABLE } from '../queue/db';
import { MemoryDatabase } from '../queue/memoryDb';
import { PunchQueue } from '../queue/PunchQueue';
import { AuthStore, PAIRING_OWNER_KEY, type StoredAccount } from '../state/authStore';
import {
  INSTALLATION_ID_KEY,
  PAIRING_KEY,
  PairingStore,
  type PairingRecord,
  type SecureStorage,
} from '../state/pairingStore';
import { completeSignIn } from './session';
import { switchAccount } from './switchAccount';

// Both stores share the `expo-secure-store` adapter at module load; the tests inject memory storage.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => '0f8fad5b-d9cb-469f-a165-70867728950e' }));

const NUM_RUNS = 150;
const BASE = 'https://api.example.in/api/v1';
const UNPAIR_URL = `${BASE}${ROUTES.unpairMe}`;
/** Short enough that a hanging answer times out quickly; long enough to never fire otherwise. */
const TIMEOUT_MS = 25;
const NOW_MS = Date.UTC(2025, 4, 12, 8, 0, 0);

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

const objectId = fc.stringMatching(/^[0-9a-f]{24}$/);
const shortText = fc.stringMatching(/^[A-Za-z][A-Za-z .'-]{0,24}$/);

const location: fc.Arbitrary<AppLocationSettings> = fc.oneof(
  fc.constant({ locationCheck: false }),
  fc.record({
    locationCheck: fc.constant(true),
    shopLat: fc.double({ min: 8, max: 35, noNaN: true }),
    shopLng: fc.double({ min: 68, max: 97, noNaN: true }),
    radiusMetres: fc.integer({ min: 50, max: 2000 }),
  }),
);

const pairing: fc.Arbitrary<PairingRecord> = fc.record({
  pairingId: objectId,
  shopId: objectId,
  employeeId: objectId,
  employeeName: shortText,
  shopName: shortText,
  location,
  consentVersion: fc.integer({ min: 1, max: 9 }),
});

/** What the network does to the one unpair call. */
type Network =
  | { kind: 'ok' }
  | { kind: 'not_paired'; message: string }
  | { kind: 'refused'; status: number; message: string }
  | { kind: 'connection' }
  | { kind: 'server_error'; status: number }
  | { kind: 'bad_answer' }
  | { kind: 'timeout' };

const network: fc.Arbitrary<Network> = fc.oneof(
  fc.constant<Network>({ kind: 'ok' }),
  fc
    .constantFrom(SERVER_MESSAGES.HR_APP_NOT_PAIRED, 'Pairing revoked')
    .map((message): Network => ({ kind: 'not_paired', message })),
  fc
    .record({
      status: fc.constantFrom(400, 409, 422, 429),
      message: fc.stringMatching(/^[A-Z][a-z ,]{3,40}$/),
    })
    .map((r): Network => ({ kind: 'refused', ...r })),
  fc.constant<Network>({ kind: 'connection' }),
  fc.constantFrom(500, 502, 503).map((status): Network => ({ kind: 'server_error', status })),
  fc.constant<Network>({ kind: 'bad_answer' }),
  fc.constant<Network>({ kind: 'timeout' }),
);

/** How many rows the queue holds in all; `waitingCount` must say `waiting` of them. */
const queueShape = fc.record({
  waiting: fc.integer({ min: 0, max: 6 }),
  refused: fc.integer({ min: 0, max: 2 }),
});

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function memoryStorage() {
  const map = new Map<string, string>();
  const storage: SecureStorage = {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async deleteItem(key) {
      map.delete(key);
    },
  };
  return { storage, map };
}

function punch(n: number, p: PairingRecord): AppPunchRequest {
  return {
    pairingId: p.pairingId,
    shopId: p.shopId,
    employeeId: p.employeeId,
    punchId: `0f6b2c1e-9c4a-4a5e-8f1d-${String(n).padStart(12, '0')}`,
    phoneTime: `2025-05-12T09:${String(n).padStart(2, '0')}:00Z`,
    offline: true,
    locationChecked: true,
    distanceMetres: 12,
    accuracyMetres: 8,
    mock: false,
    signature: `sig-${n}`,
  };
}

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function envelope(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A `fetch` that records every request and answers each one as `network` says. */
function fakeFetch(net: Network) {
  const captured: Captured[] = [];
  const fetch: FetchLike = (url, init) => {
    captured.push({
      url,
      method: String(init.method),
      headers: { ...(init.headers as Record<string, string>) },
    });
    switch (net.kind) {
      case 'ok':
        return Promise.resolve(envelope(200, { success: true, data: { unpaired: true } }));
      case 'not_paired':
        return Promise.resolve(
          envelope(403, { success: false, error: net.message, data: { message: net.message } }),
        );
      case 'refused':
        return Promise.resolve(
          envelope(net.status, {
            success: false,
            error: net.message,
            data: { message: net.message },
          }),
        );
      case 'connection':
        return Promise.reject(new TypeError('Network request failed'));
      case 'server_error':
        return Promise.resolve(new Response('<html>502</html>', { status: net.status }));
      case 'bad_answer':
        return Promise.resolve(new Response('<html>proxy</html>', { status: 200 }));
      case 'timeout':
        return new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        });
    }
  };
  return { fetch, captured };
}

/** A device key stand-in: counts the signatures made; the bytes themselves are the client's test. */
function stubSigner() {
  const signer: RequestSigner & { calls: number } = {
    calls: 0,
    async signRequest() {
      signer.calls += 1;
      return 'MEUCIQDkZmFrZS1zaWduYXR1cmU=';
    },
  };
  return signer;
}

/** A paired phone with `waiting` offline punches (`refused` of them refused), keys and an installation id. */
async function phone(
  p: PairingRecord,
  queueRows: { waiting: number; refused: number },
  net: Network,
  owner: string | null = null,
) {
  const { storage, map } = memoryStorage();
  const db = new MemoryDatabase();
  const queue = new PunchQueue(db, { now: () => NOW_MS });
  const keys = { deleted: 0 };
  const authStore = new AuthStore({ storage });
  const pairingStore = new PairingStore({
    storage,
    deleteKeys: async () => {
      keys.deleted += 1;
    },
    deleteQueue: () => queue.clear(),
    forgetOwner: () => authStore.clearPairingOwner(),
  });
  await pairingStore.save(p);
  await pairingStore.installationId();
  if (owner != null) {
    await authStore.setPairingOwnerUserId(owner);
  }
  // The phone opens the queue file before anything else; here that creates the table so an empty
  // queue can be dumped like a full one.
  await queue.waitingCount();
  const total = queueRows.waiting + queueRows.refused;
  for (let n = 1; n <= total; n++) {
    await queue.enqueue(punch(n, p), 'IN');
    if (n <= queueRows.refused) {
      await queue.markRefused(punch(n, p).punchId, 'Fake location detected');
    }
  }
  const signer = stubSigner();
  const { fetch, captured } = fakeFetch(net);
  const client = new AppClient({
    baseUrl: BASE,
    signer,
    pairingId: async () => (await pairingStore.load())?.pairingId ?? null,
    fetch,
    timeoutMs: TIMEOUT_MS,
  });
  const onError = vi.fn();
  const prompts: ConfirmPrompt[] = [];
  return {
    map,
    db,
    queue,
    keys,
    pairingStore,
    authStore,
    client,
    signer,
    captured,
    onError,
    prompts,
    deps: { queue, client, pairingStore, onError },
    confirmWith(decision: boolean) {
      return async (prompt: ConfirmPrompt) => {
        prompts.push(prompt);
        return decision;
      };
    },
  };
}

type Phone = Awaited<ReturnType<typeof phone>>;

/** Everything the switch must delete, as one snapshot. */
function deviceSet(p: Phone) {
  return {
    store: Object.fromEntries(p.map),
    queue: p.db.dump(PUNCH_QUEUE_TABLE),
    keysDeleted: p.keys.deleted,
  };
}

/** The R9.7 warning as the requirement words it, written out independently of `switchAccountPrompt`. */
function expectWarningFor(prompt: ConfirmPrompt, waiting: number): void {
  expect(prompt.question).toBe(STRINGS_EN['switchAccount.question']);
  expect(prompt.confirmLabel).toBe(STRINGS_EN['switchAccount.confirm']);
  expect(prompt.cancelLabel).toBe(STRINGS_EN['common.cancel']);
  const explanation = prompt.explanation ?? '';
  expect(explanation.startsWith(STRINGS_EN['switchAccount.explanation'])).toBe(true);
  const lost = /(\d+) punch(?:es)? that (?:was|were) not yet sent will be lost/.exec(explanation);
  if (waiting === 0) {
    expect(lost).toBeNull();
  } else {
    expect(lost).not.toBeNull();
    expect(Number(lost?.[1])).toBe(waiting);
    expect(explanation).toContain(
      waiting === 1
        ? '1 punch that was not yet sent will be lost'
        : `${waiting} punches that were not yet sent will be lost`,
    );
  }
}

/** The one unpair call: the device envelope, signed, and never the Bearer token (R9.1). */
function expectOneUnpairCall(p: Phone, pairingId: string): void {
  expect(p.captured).toHaveLength(1);
  const call = p.captured[0];
  expect(call.method).toBe('POST');
  expect(call.url).toBe(UNPAIR_URL);
  expect(call.headers[HEADER_PAIRING_ID]).toBe(pairingId);
  expect(call.headers[HEADER_TIMESTAMP]).toMatch(/^\d+$/);
  expect(call.headers[HEADER_NONCE]).toMatch(/^[0-9a-f-]{36}$/);
  expect(call.headers[HEADER_SIGNATURE]).not.toBe('');
  expect(Object.keys(call.headers).some((h) => h.toLowerCase() === 'authorization')).toBe(false);
  expect(p.signer.calls).toBe(1);
}

/** The device set after a confirmed switch: record, installation id, owner, keys and queue gone. */
async function expectWiped(p: Phone): Promise<void> {
  expect(p.map.has(PAIRING_KEY)).toBe(false);
  expect(p.map.has(INSTALLATION_ID_KEY)).toBe(false);
  expect(p.map.has(PAIRING_OWNER_KEY)).toBe(false);
  expect(await p.pairingStore.load()).toBeNull();
  expect(await p.authStore.pairingOwnerUserId()).toBeNull();
  expect(p.db.dump(PUNCH_QUEUE_TABLE)).toEqual([]);
  expect(await p.queue.waitingCount()).toBe(0);
  expect(p.keys.deleted).toBe(1);
}

// ---------------------------------------------------------------------------------------------
// Property 23
// ---------------------------------------------------------------------------------------------

describe('Feature: worker-app, Property 23: Signing in with a different account unpairs, whatever the network does', () => {
  it('for any pairing, queue and network: the warning names the waiting count; confirm sends the unpair call exactly once and leaves the device set deleted whatever the answer; cancel sends nothing and touches nothing (R9.7)', async () => {
    await fc.assert(
      fc.asyncProperty(
        pairing,
        queueShape,
        network,
        fc.boolean(),
        fc.option(objectId, { nil: null }),
        async (p, queueRows, net, decision, owner) => {
          const ph = await phone(p, queueRows, net, owner);
          const before = deviceSet(ph);

          const result = await switchAccount(ph.deps, ph.confirmWith(decision));

          expect(ph.prompts).toHaveLength(1);
          expectWarningFor(ph.prompts[0], queueRows.waiting);

          if (!decision) {
            expect(result).toBe('cancelled');
            expect(ph.captured).toEqual([]);
            expect(ph.signer.calls).toBe(0);
            expect(deviceSet(ph)).toEqual(before);
            expect(await ph.pairingStore.load()).toEqual(p);
            expect(await ph.authStore.pairingOwnerUserId()).toBe(owner);
            expect(await ph.queue.waitingCount()).toBe(queueRows.waiting);
            expect(ph.onError).not.toHaveBeenCalled();
            return;
          }

          expect(result).toBe('switched');
          expectOneUnpairCall(ph, p.pairingId);
          await expectWiped(ph);

          // Only a refusal that is neither "not reachable" nor "not paired" is worth a report.
          if (net.kind === 'refused') {
            expect(ph.onError).toHaveBeenCalledTimes(1);
            expect(ph.onError.mock.calls[0][0]).toBe('unpair call');
          } else {
            expect(ph.onError).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);

  it('through completeSignIn: the account signing in is asked once iff a pairing is stored whose recorded owner is not this account (a missing owner counts as another account); a cancel stores nothing of it and does not re-resolve; a confirm signs in only after the unpair call and the wipe; the same owner is never asked and never unpairs (R9.6, R9.7)', async () => {
    const storedAccount: fc.Arbitrary<StoredAccount> = fc.record({
      accessToken: fc.stringMatching(/^[A-Za-z0-9._-]{8,40}$/),
      userId: objectId,
      name: shortText,
      email: fc.emailAddress(),
      role: fc.constantFrom('WORKER', 'MANAGER'),
    });
    /** Who the pairing was made under, relative to the account signing in. */
    const ownerCase = fc.constantFrom<'same' | 'other' | 'missing'>('same', 'other', 'missing');
    await fc.assert(
      fc.asyncProperty(
        pairing,
        queueShape,
        network,
        fc.boolean(),
        ownerCase,
        objectId,
        fc.option(storedAccount, { nil: null }),
        storedAccount,
        async (p, queueRows, net, decision, ownerKind, otherOwner, previous, incoming) => {
          const owner =
            ownerKind === 'same' ? incoming.userId : ownerKind === 'other' ? otherOwner : null;
          const ph = await phone(p, queueRows, net, owner);
          if (previous) {
            // The account last signed in here (kept across a session end, gone after a log out)
            // plays no part in the decision: only the pairing's owner does.
            await ph.authStore.saveAccount(previous);
          }
          const switchNeeded = owner !== incoming.userId;
          const before = deviceSet(ph);
          const shell = {
            refresh: vi.fn(async () => undefined),
            confirm: vi.fn(ph.confirmWith(decision)),
          };
          const uploadPhoto = vi.fn(async () => {
            throw new Error('no photo in this property');
          });

          const result = await completeSignIn(
            {
              ...ph.deps,
              authStore: ph.authStore,
              account: { uploadPhoto },
              pairingStore: ph.pairingStore,
            },
            shell,
            incoming,
          );

          if (!switchNeeded) {
            // The same account comes back: the pairing is inherited as is, no code needed (R9.6).
            expect(ownerKind).toBe('same');
            expect(shell.confirm).not.toHaveBeenCalled();
            expect(ph.captured).toEqual([]);
            expect(ph.signer.calls).toBe(0);
            expect(ph.map.get(PAIRING_KEY)).toBe(before.store[PAIRING_KEY]);
            expect(ph.map.get(INSTALLATION_ID_KEY)).toBe(before.store[INSTALLATION_ID_KEY]);
            expect(ph.map.get(PAIRING_OWNER_KEY)).toBe(incoming.userId);
            expect(ph.db.dump(PUNCH_QUEUE_TABLE)).toEqual(before.queue);
            expect(ph.keys.deleted).toBe(0);
            expect(result).toBe('signed_in');
            expect(await ph.authStore.account()).toEqual(incoming);
            expect(shell.refresh).toHaveBeenCalledTimes(1);
            return;
          }

          expect(shell.confirm).toHaveBeenCalledTimes(1);
          expectWarningFor(ph.prompts[0], queueRows.waiting);

          if (!decision) {
            // The new sign-in does not proceed: whatever account was stored still is.
            expect(result).toBe('cancelled');
            expect(ph.captured).toEqual([]);
            expect(deviceSet(ph)).toEqual(before);
            expect(await ph.authStore.account()).toEqual(previous);
            expect(await ph.authStore.pairingOwnerUserId()).toBe(owner);
            expect(shell.refresh).not.toHaveBeenCalled();
            return;
          }

          expect(result).toBe('signed_in');
          expectOneUnpairCall(ph, p.pairingId);
          await expectWiped(ph);
          expect(await ph.authStore.account()).toEqual(incoming);
          expect(shell.refresh).toHaveBeenCalledTimes(1);
          expect(uploadPhoto).not.toHaveBeenCalled();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);
});
