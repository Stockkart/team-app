/**
 * Live contract test: the app's real client code against a running `inventory-api` (HR-module
 * checkpoint 15, extended by worker-app task 15.1). It proves that the canonical punch payload,
 * the signed request envelope, the Base64 DER signature encoding, the Bearer calls of the worker
 * app and the DTO shapes the TypeScript side produces are the ones the Java side verifies and
 * parses, end to end over HTTPS, through the backend's real interceptor chain
 * (`AuthenticationInterceptor`, `RbacModuleInterceptor` skip list, `PlanExpiryInterceptor`,
 * `AttendanceAppAuthInterceptor`, body caching filter), not the standalone MockMvc wiring of
 * `AttendanceAppControllerIT` and `WorkerControllerIT`.
 *
 * One suite, the worker's whole day: `AccountClient` (Bearer), `AppClient` (envelope), `AuthStore`,
 * `completeSignIn`, `AppStateMachine.resolve` run the way `useAppState` runs it (without React),
 * `PairingFlow` over `WorkerPairingClient` and `ownedPairingStore`, `PunchFlow`, `PunchQueue` +
 * `SyncWorker` (offline path), `loadHistory`, `logout`, `switchAccount`,
 * `removePhone`, `PairingStore`, and the transport for the one request neither client can build
 * (both credentials at once). There is no login-less path (D11): every pairing is redeemed with the
 * Bearer token, and a punch never needs a session (R9.10).
 *
 * Only the hardware is faked: `FakeBiometricSigner` (real P-256 keys in WebCrypto), an in-memory
 * `SecureStorage`, a `MemoryDatabase` for SQLite and a location reader that is never asked (the
 * shop's Location check stays off).
 *
 * The manager's side (sign up, register a shop, save the HR settings with the switch on, add an
 * employee, read the inbox, approve, create the pairing code, read the employee) goes through the
 * backend's own Bearer endpoints with plain `fetch`, so nothing is written to MongoDB by hand and
 * the test needs no database driver.
 *
 * Skipped unless `ATTENDANCE_CONTRACT_URL` is set (an `https://host[:port]/api/v1` base; the client
 * refuses anything else, R9.7). The backend may run with a self-signed certificate: point
 * `NODE_EXTRA_CA_CERTS` at its PEM before starting vitest. See `README.md`,
 * "Live contract test", for the full recipe.
 *
 * The suite signs up a fresh owner and shop, so a run leaves nothing behind that a second run
 * trips over and needs no cleanup on a throwaway database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  DUPLICATE_SENTENCE,
  SERVER_MESSAGES,
  WORKER_SERVER_MESSAGES,
  punchConfirmation,
  refusalText,
} from '@stockkart/attendance-protocol';
import type {
  AppPunchRequest,
  AppPunchResponse,
  ClaimPairingResponse,
  PairingBootstrap,
} from '@stockkart/attendance-protocol';

import { logout } from '../account/logout';
import { completeSignIn } from '../account/session';
import { AccountClient, inferAccountErrorCode } from '../api/accountClient';
import { AppClient, HEADER_PAIRING_ID, ServerRefusal, isServerRefusal } from '../api/appClient';
import { createTransport, isNotAuthenticated, isNotReachable } from '../api/transport';
import {
  resolve,
  type AppRoute,
  type ServerAnswer,
  type StoredRecord,
} from '../app/AppStateMachine';
import type { ConfirmPrompt } from '../app/useAppState';
import { HistoryCache, type HistoryEntry } from '../history/HistoryCache';
import { loadHistory } from '../history/loadHistory';
import type { LocationReader } from '../location/LocationReader';
import { tilesFor } from '../modules/registry';
import { ownedPairingStore } from '../pairing/ownedPairingStore';
import { PairingFlow } from '../pairing/PairingFlow';
import { WorkerPairingClient } from '../pairing/WorkerPairingClient';
import { PunchFlow } from '../punch/PunchFlow';
import { ALWAYS_REACHABLE } from '../punch/reachability';
import { MemoryDatabase } from '../queue/memoryDb';
import { PunchQueue } from '../queue/PunchQueue';
import { SyncWorker, type QueueState } from '../queue/SyncWorker';
import { removePhone } from '../settings/removePhone';
import { FakeBiometricSigner } from '../signer/FakeBiometricSigner';
import { AuthStore, type StoredAccount } from '../state/authStore';
import { NotificationsCache } from '../state/NotificationsCache';
import { PairingStore, type SecureStorage } from '../state/pairingStore';

// `PairingStore` imports the Expo modules at module scope; the test injects its own storage and
// UUID source, so the modules only need to load (vi.mock is hoisted above the imports).
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));

const BASE_URL = process.env['ATTENDANCE_CONTRACT_URL'];

// ---- manager side: plain fetch against the Bearer endpoints -----------------------------------

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

async function api<T>(
  method: 'GET' | 'POST' | 'PUT',
  route: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(`${BASE_URL}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || payload.success !== true) {
    throw new Error(
      `${method} ${route} → ${response.status}: ${JSON.stringify(payload).slice(0, 400)}`,
    );
  }
  return payload.data as T;
}

/** `yyyy-MM-dd` in Asia/Kolkata, `days` before today. */
function kolkataDate(daysAgo: number): string {
  const ms = Date.now() - daysAgo * 86_400_000 + (5 * 60 + 30) * 60_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const PASSWORD = 'contract-test-pass-1';

/** A unique suffix for e-mails and business ids; one per call. */
function stamp(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function randomPhone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

interface Owner {
  token: string;
  shopId: string;
  shopName: string;
  /** The owner account's name; its first token is what the worker's Find shop shows (R3.2). */
  ownerName: string;
  ownerEmail: string;
}

/**
 * A fresh owner and shop with the HR settings saved and the Biometric app switch on (the manager
 * side of the worker-app flow, with plain `fetch`); returns the Bearer token and the ids.
 */
async function seedOwner(): Promise<Owner> {
  const tag = stamp();
  const ownerName = `Ramesh Contract${tag}`;
  const ownerEmail = `contract-${tag}@example.invalid`;
  const signup = await api<{ accessToken: string }>('POST', '/auth/signup', {
    name: ownerName,
    email: ownerEmail,
    password: PASSWORD,
    phone: randomPhone(),
    role: 'OWNER',
  });
  const token = signup.accessToken;
  const shopName = `Contract Shop ${tag}`;
  const shop = await api<{ shopId: string }>(
    'POST',
    '/shops/register',
    {
      name: shopName,
      businessId: `CT-${tag}`,
      location: { primaryAddress: '1 Test Road', state: 'KA', city: 'Bengaluru', pin: '560001' },
      contactEmail: `shop-${tag}@example.invalid`,
      contactPhone: '9876500000',
      shopType: 'RETAILER',
      verticalId: 'grocery',
    },
    token,
  );
  const settings = await api<{ attendanceCapture: { biometricApp: boolean } }>(
    'PUT',
    '/hr/settings',
    { attendanceCapture: { biometricApp: true } },
    token,
  );
  expect(settings.attendanceCapture.biometricApp).toBe(true);
  return { token, shopId: shop.shopId, shopName, ownerName, ownerEmail };
}

// ---- worker side: the real modules over fakes for the hardware ---------------------------------

function memoryStorage(): SecureStorage {
  const map = new Map<string, string>();
  return {
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
}

/** The shop's Location check is off in this test, so the reader must never be asked. */
const neverRead: Pick<LocationReader, 'read'> = {
  read: async () => {
    throw new Error('Location check is off: the reader must not be called');
  },
};

interface Phone {
  signer: FakeBiometricSigner;
  store: PairingStore;
  client: AppClient;
  db: MemoryDatabase;
  queue: PunchQueue;
  history: HistoryCache;
  /** Every request `PunchFlow` posted, for the replay check. */
  sent: AppPunchRequest[];
  /** Overrides the pairing id the client signs with (null = what the store holds). */
  forcePairingId: (id: string | null | undefined) => void;
}

function phone(auth: AuthStore): Phone {
  const signer = new FakeBiometricSigner();
  const db = new MemoryDatabase();
  const queue = new PunchQueue(db);
  const history = new HistoryCache(db);
  const store = new PairingStore({
    storage: memoryStorage(),
    randomUUID: () => crypto.randomUUID(),
    deleteKeys: () => signer.deleteKeys(),
    deleteQueue: () => queue.clear(),
    forgetOwner: () => auth.clearPairingOwner(),
  });
  let forced: string | null | undefined;
  const client = new AppClient({
    baseUrl: BASE_URL as string,
    signer,
    pairingId: async () =>
      forced !== undefined ? forced : (await store.load())?.pairingId ?? null,
    fetch: (input, init) => fetch(input, init),
  });
  return {
    signer,
    store,
    client,
    db,
    queue,
    history,
    sent: [],
    forcePairingId: (id) => {
      forced = id;
    },
  };
}

function punchFlow(p: Phone, options: { offline?: boolean; clock?: () => number } = {}): PunchFlow {
  return new PunchFlow({
    client: {
      postPunch: (request) => {
        p.sent.push(request);
        return p.client.postPunch(request);
      },
    },
    signer: p.signer,
    locationReader: neverRead,
    pairingStore: p.store,
    reachability: options.offline ? { probe: async () => false } : ALWAYS_REACHABLE,
    queue: p.queue,
    clock: options.clock,
  });
}

const DEVICE = {
  os: 'ANDROID' as const,
  osVersion: '14',
  phoneModel: 'Contract Phone',
  appVersion: '0.0.1',
};

// ---- the worker's phone: the HR-module modules plus the account layer ---------------------------

/** The HR-module phone plus the account layer: what `src/app/deps.ts` builds on a real phone. */
interface WorkerPhone extends Phone {
  auth: AuthStore;
  account: AccountClient;
  notifications: NotificationsCache;
  workerPairingFlow: PairingFlow;
  /** The route the shell last resolved to (`useAppState` state), or null before the first run. */
  route: AppRoute | null;
  /** Every R9.7 question the shell's confirm sheet was asked; the answer is always "yes". */
  confirms: ConfirmPrompt[];
  /** What a screen gets as `ShellActions` (`refresh`, `confirm`); the rest is not needed here. */
  shell: {
    refresh(): Promise<void>;
    confirm(prompt: ConfirmPrompt): Promise<boolean>;
  };
  /** The screen credentials for a sign-in after a log out. */
  credentials: { email: string; password: string };
}

function workerPhone(credentials: { email: string; password: string }): WorkerPhone {
  // `AuthStore` first: `PairingStore.wipe()` forgets the pairing's owner through it (R9.5).
  const authStorage = memoryStorage();
  let caches: (() => Promise<void>) | null = null;
  const auth = new AuthStore({
    storage: authStorage,
    clearCaches: async () => {
      await caches?.();
    },
  });
  const base = phone(auth);
  const notifications = new NotificationsCache(base.db);
  caches = async () => {
    await base.history.clear();
    await notifications.clear();
  };
  const account = new AccountClient({
    baseUrl: BASE_URL as string,
    tokens: auth,
    fetch: (input, init) => fetch(input, init),
  });
  const workerPairingFlow = new PairingFlow({
    client: new WorkerPairingClient(account),
    signer: base.signer,
    // Writes `pairingOwnerUserId` when a pairing completes, as `src/app/deps.ts` does (R9.5–R9.7).
    store: ownedPairingStore(base.store, auth, (context, error) => {
      throw new Error(`${context}: ${String(error)}`);
    }),
    device: DEVICE,
  });
  const w: WorkerPhone = {
    ...base,
    auth,
    account,
    notifications,
    workerPairingFlow,
    route: null,
    confirms: [],
    credentials,
    shell: {
      refresh: async () => {
        w.route = await shellResolve(w);
      },
      confirm: async (prompt) => {
        w.confirms.push(prompt);
        return true;
      },
    },
  };
  return w;
}

/**
 * One resolution of the shell, exactly as `useAppState.run` does it without React: read the two
 * stores, read `GET /hr/worker/me` (or take `given`), store the last state or clear the session
 * (R6.1, R6.7, R9.3).
 */
async function shellResolve(w: WorkerPhone, given?: ServerAnswer): Promise<AppRoute> {
  const snapshot = await w.auth.snapshot();
  const pairing = await w.store.load();
  const stored: StoredRecord = {
    token: snapshot.accessToken,
    accountPhone: snapshot.profile?.phone ?? null,
    lastState: snapshot.lastState,
    pairing,
  };
  let answer: ServerAnswer | undefined = given;

  if (stored.token != null && answer === undefined) {
    try {
      answer = { kind: 'state', state: await w.account.workerState() };
    } catch (error) {
      if (isNotAuthenticated(error)) {
        answer = { kind: 'not_authenticated' };
      } else if (isNotReachable(error)) {
        answer = { kind: 'not_reachable' };
      } else {
        throw error;
      }
    }
  }

  const resolution = resolve(stored, answer ?? { kind: 'not_reachable' });
  if (stored.token != null && answer?.kind === 'not_authenticated') {
    await w.auth.clearSession();
  } else if (answer?.kind === 'state' && resolution.stored.lastState) {
    await w.auth.saveLastState(resolution.stored.lastState);
    // The stored profile's phone follows the answer's `account.phone` (R1.11, DD20), as the hook does.
    const phone = resolution.stored.accountPhone ?? undefined;
    if (snapshot.profile != null && (snapshot.profile.phone ?? undefined) !== phone) {
      await w.auth.updateProfile({ phone });
    }
  }
  return resolution.route;
}

/** `completeSignIn` with this phone's stores, as the Sign in and Create account screens call it. */
function signInOn(w: WorkerPhone, account: StoredAccount) {
  return completeSignIn(
    {
      authStore: w.auth,
      account: w.account,
      pairingStore: w.store,
      queue: w.queue,
      client: w.client,
      onError: (context, error) => {
        throw new Error(`${context}: ${String(error)}`);
      },
    },
    w.shell,
    account,
  );
}

/** Sign up a worker on a phone and land where the state says; returns the stored account. */
async function createWorker(w: WorkerPhone, name: string, phone: string): Promise<StoredAccount> {
  const account = await w.account.createAccount({
    name,
    email: w.credentials.email,
    password: w.credentials.password,
    phone,
  });
  expect(await signInOn(w, account)).toBe('signed_in');
  return account;
}

async function catchRefusal(call: () => Promise<unknown>): Promise<ServerRefusal> {
  try {
    await call();
  } catch (error) {
    if (isServerRefusal(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a server refusal');
}

interface JoinRequestRowLike {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  hasPossibleMatch: boolean;
}

/** The manager approves the one pending request of `workerEmail` with CREATE; the employee id. */
async function approveCreate(owner: Owner, workerEmail: string): Promise<string> {
  const inbox = await api<{ items: JoinRequestRowLike[]; pendingCount: number }>(
    'GET',
    '/hr/join-requests?status=PENDING&page=0&size=50',
    undefined,
    owner.token,
  );
  const row = inbox.items.find((item) => item.email === workerEmail);
  expect(row).toBeDefined();
  const decision = await api<{ id: string; outcome: string; employeeId: string }>(
    'POST',
    `/hr/join-requests/${(row as JoinRequestRowLike).id}/approve`,
    { mode: 'CREATE' },
    owner.token,
  );
  expect(decision).toMatchObject({
    id: (row as JoinRequestRowLike).id,
    outcome: 'APPROVED_CREATED',
  });
  expect(decision.employeeId).toMatch(/^[0-9a-f]{24}$/);
  return decision.employeeId;
}

async function pairingStateOf(owner: Owner, employeeId: string): Promise<string> {
  const state = await api<{ state: string }>(
    'GET',
    `/hr/employees/${employeeId}/pairing`,
    undefined,
    owner.token,
  );
  return state.state;
}

describe.skipIf(!BASE_URL)('Stockkart Team ↔ inventory-api live contract', () => {
  let owner: Owner;
  let priya: WorkerPhone;
  let ravi: WorkerPhone;
  let priyaEmployeeId: string;
  let raviEmployeeId: string;
  let priyaPairingId: string;
  let raviPairingId: string;
  let priyaBootstrap: PairingBootstrap;
  let firstPunch: AppPunchResponse;

  beforeAll(async () => {
    owner = await seedOwner();
    const tag = stamp();
    priya = workerPhone({ email: `priya-${tag}@example.invalid`, password: PASSWORD });
    ravi = workerPhone({ email: `ravi-${tag}@example.invalid`, password: PASSWORD });
  }, 60_000);

  afterAll(async () => {
    await priya?.db.closeAsync();
    await ravi?.db.closeAsync();
  });

  it('Create account makes a WORKER with no shop and lands on Join (R1.5, R1.6, R6.1)', async () => {
    const account = await createWorker(priya, 'Priya Sharma', '+91 98765 43210');
    expect(account.role).toBe('WORKER');
    expect(account.userId).toMatch(/^[0-9a-f]{24}$/);
    expect(await priya.auth.profile()).toMatchObject({
      userId: account.userId,
      name: 'Priya Sharma',
      email: priya.credentials.email,
      role: 'WORKER',
    });

    // The shell's first resolution: Join, with nothing a shop would give (R6.1).
    expect(priya.route).toMatchObject({ name: 'Join', state: { state: 'NO_SHOP', modules: [] } });
    const state = await priya.account.workerState();
    expect(state).toMatchObject({
      state: 'NO_SHOP',
      account: { userId: account.userId, role: 'WORKER', phone: '9876543210' },
      modules: [],
      notifications: { unread: 0 },
    });
    expect(state.shop ?? null).toBeNull();
    expect(state.employee ?? null).toBeNull();
    expect(state.request ?? null).toBeNull();
  });

  it('the phone step: PUT /users/me/profile with the phone alone changes the phone and nothing else; an account the server says has no phone resolves to NeedsPhone, then to Join once saved (R1.11, R1.12; DD20)', async () => {
    // Google is verified by the real backend against Google, so there is no fresh-e-mail
    // `signInWithGoogle` → `OAUTH_ACCOUNT_NOT_FOUND` step here (no token can be minted for it), and
    // no account without a phone can be created through the API (every sign-up shape the backend
    // accepts requires one, or is OAuth). What is live is the phone-only `PUT /users/me/profile`
    // contract of task 22.1 and `resolve` over a real `/me`; the empty phone is a `/me` answer with
    // `account.phone` stripped, fed to the shell as `useAppState.apply` would (`given`).
    const before = await priya.account.workerState();
    const noPhone = { ...before, account: { ...before.account, phone: null } };
    expect(await shellResolve(priya, { kind: 'state', state: noPhone })).toEqual({
      name: 'NeedsPhone',
      state: expect.objectContaining({ state: 'NO_SHOP' }),
    });
    // The answer was stored as the last state even though no shop screen was shown.
    expect(await priya.auth.lastState()).toMatchObject({ state: 'NO_SHOP' });

    // Save (the screen's `update` branch): the phone alone, normalised here as the screen does.
    const saved = await priya.account.updateAccountProfile({ phone: '9123456780' });
    expect(saved).toMatchObject({
      userId: (await priya.auth.profile())?.userId,
      name: 'Priya Sharma',
      email: priya.credentials.email,
      role: 'WORKER',
      phone: '9123456780',
    });
    await priya.auth.updateProfile({ phone: saved.phone as string });
    await priya.shell.refresh();
    expect(priya.route).toMatchObject({ name: 'Join', state: { state: 'NO_SHOP' } });
    const after = await priya.account.workerState();
    expect(after.account).toMatchObject({ name: 'Priya Sharma', phone: '9123456780' });
    expect(after.account.email).toBe(before.account.email);

    // The server applies the R1.2 rule and refuses what the screen would have refused first.
    const refused = await catchRefusal(() =>
      priya.account.updateAccountProfile({ phone: '12345' }),
    );
    expect(refused.status).toBe(400);
    expect((await priya.account.workerState()).account.phone).toBe('9123456780');
    const blank = await catchRefusal(() => priya.account.updateAccountProfile({ phone: '' }));
    expect(blank.status).toBe(400);

    // `+91` and spaces are stripped server-side too; put the number the rest of the suite expects back.
    const restored = await priya.account.updateAccountProfile({ phone: '+91 98765 43210' });
    expect(restored.phone).toBe('9876543210');
    await priya.auth.updateProfile({ phone: '9876543210' });
    await priya.shell.refresh();
    expect(priya.route).toMatchObject({ name: 'Join' });
    expect((await priya.auth.profile())?.phone).toBe('9876543210');
  });

  it('Find shop answers the owner\u2019s shop and one empty answer for a miss (R3.2, R3.3)', async () => {
    const found = await priya.account.lookupShops(` ${owner.ownerEmail.toUpperCase()} `);
    expect(found).toEqual({
      shops: [{ shopId: owner.shopId, shopName: owner.shopName, ownerFirstName: 'Ramesh' }],
    });
    // the worker's own e-mail owns nothing; an unknown e-mail is the same answer (R11.4)
    expect(await priya.account.lookupShops(priya.credentials.email)).toEqual({ shops: [] });
    expect(await priya.account.lookupShops(`nobody-${stamp()}@example.invalid`)).toEqual({
      shops: [],
    });
  });

  it('"Yes, this is my shop" files one request and lands on Waiting (R3.4, R3.5)', async () => {
    const request = await priya.account.createJoinRequest(owner.shopId);
    expect(request).toMatchObject({ shopName: owner.shopName, status: 'PENDING' });
    expect(request).not.toHaveProperty('kind');
    expect(request.id).toMatch(/^[0-9a-f]{24}$/);
    expect(Math.abs(Date.parse(request.requestedAt) - Date.now())).toBeLessThan(60_000);

    await priya.shell.refresh();
    expect(priya.route).toMatchObject({
      name: 'Waiting',
      state: { state: 'PENDING', modules: [], request: { id: request.id } },
    });
    expect(await priya.auth.lastState()).toMatchObject({ state: 'PENDING' });

    // a second request while one waits: the server's one-pending rule, text word for word (R3.5)
    const again = await catchRefusal(() => priya.account.createJoinRequest(owner.shopId));
    expect(again).toMatchObject({
      status: 409,
      code: 'HR_WORKER_REQUEST_PENDING',
      serverMessage: WORKER_SERVER_MESSAGES.HR_WORKER_REQUEST_PENDING,
    });
  });

  it('the manager approves with CREATE; the next read lands on Home with three modules (R4.8, R6.1, R6.4)', async () => {
    const inbox = await api<{ items: JoinRequestRowLike[]; pendingCount: number }>(
      'GET',
      '/hr/join-requests?status=PENDING&page=0&size=50',
      undefined,
      owner.token,
    );
    expect(inbox.pendingCount).toBe(1);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({
      name: 'Priya Sharma',
      phone: '9876543210',
      email: priya.credentials.email,
      status: 'PENDING',
      hasPossibleMatch: false,
    });

    priyaEmployeeId = await approveCreate(owner, priya.credentials.email);

    await priya.shell.refresh();
    expect(priya.route).toMatchObject({
      name: 'Home',
      offline: false,
      state: {
        state: 'ACTIVE',
        modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
        shop: { shopId: owner.shopId, shopName: owner.shopName },
        employee: { employeeId: priyaEmployeeId, name: 'Priya Sharma', status: 'ACTIVE' },
        pairing: { state: 'NOT_PAIRED' },
        today: { nextDirection: 'IN' },
      },
    });
    const home = priya.route as Extract<AppRoute, { name: 'Home' }>;
    expect(home.state.employee?.joinDate).toBe(kolkataDate(0));
    expect(home.state.today?.in ?? null).toBeNull();
    expect(tilesFor(home.state.modules).map((tile) => tile.kind)).toEqual([
      'module',
      'module',
      'module',
    ]);

    // the approval notification reached the account (R4.13, R10.1)
    const state = await priya.account.workerState();
    expect(state.notifications.unread).toBe(1);
    expect(state.notifications.top[0]).toMatchObject({ type: 'JOIN_REQUEST_APPROVED' });
    expect(state.notifications.top[0].text).toContain(owner.shopName);
  });

  it('a pairing code is redeemed over the worker path with the login, and the phone records whose pairing it is (R7.2, R7.3, R9.5)', async () => {
    const code = await api<{ code: string; qrPayload: string }>(
      'POST',
      `/hr/employees/${priyaEmployeeId}/pairing-codes`,
      undefined,
      owner.token,
    );

    const claimed = await priya.workerPairingFlow.submitCode(code.qrPayload);
    expect(claimed.kind).toBe('claimed');
    const claim = (claimed as { claim: ClaimPairingResponse }).claim;
    expect(claim.employeeName).toBe('Priya Sharma');
    expect(claim.shopName).toBe(owner.shopName);
    expect(claim.consent.version).toBeGreaterThan(0);

    const agreed = await priya.workerPairingFlow.agree(claim.claimToken, claim.consent.version);
    expect(agreed.kind).toBe('paired');
    priyaBootstrap = (agreed as { pairing: PairingBootstrap }).pairing;
    expect(priyaBootstrap).toMatchObject({ shopId: owner.shopId, employeeId: priyaEmployeeId });
    expect(priyaBootstrap.location.locationCheck).toBe(false);
    expect(priyaBootstrap.consentVersion).toBe(claim.consent.version);
    priyaPairingId = priyaBootstrap.pairingId;
    expect(priyaPairingId).toMatch(/^[0-9a-f]{24}$/);
    expect(await priya.store.load()).toMatchObject({ pairingId: priyaPairingId });
    expect(priya.signer.hasKeys()).toBe(true);
    expect(await pairingStateOf(owner, priyaEmployeeId)).toBe('PAIRED');

    // The phone remembers which account made the pairing (R9.5): the next sign-in compares itself
    // with this, and nothing else, to tell the same account from a different one (R9.6, R9.7).
    const profile = await priya.auth.profile();
    expect(await priya.auth.pairingOwnerUserId()).toBe(profile?.userId);

    // The manager's page sees the Paired state with the model the phone reported (HR R2.2).
    const state = await api<{ state: string; phoneModel: string; lastPunchAt: string | null }>(
      'GET',
      `/hr/employees/${priyaEmployeeId}/pairing`,
      undefined,
      owner.token,
    );
    expect(state).toMatchObject({
      state: 'PAIRED',
      phoneModel: 'Contract Phone',
      lastPunchAt: null,
    });

    // Home now says Paired.
    await priya.shell.refresh();
    expect(priya.route).toMatchObject({
      name: 'Home',
      state: { state: 'ACTIVE', pairing: { state: 'PAIRED', pairingId: priyaPairingId } },
    });
  });

  it('GET /attendance-app/me through the signed envelope answers the punch screen (HR R4.1, R9.8)', async () => {
    const status = await priya.client.getMe();
    expect(status).toMatchObject({
      employeeName: 'Priya Sharma',
      biometricApp: true,
      canPunch: true,
      nextDirection: 'IN',
      todayIn: null,
    });
    expect(status.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(status.consent).toMatchObject({
      reconsentRequired: false,
      agreedVersion: priyaBootstrap.consentVersion,
    });
    expect(priya.client.hasServerTime).toBe(true);
  });

  it('Log out keeps the pairing and its owner; a punch with the session logged out is stored; signing in again returns to Home with Attendance enabled (R9.5, R9.6, R9.10)', async () => {
    const queued = await priya.queue.waitingCount();
    await logout(
      {
        account: priya.account,
        authStore: priya.auth,
        onError: (context, error) => {
          throw new Error(`${context}: ${String(error)}`);
        },
      },
      priya.shell,
    );
    expect(priya.route).toEqual({ name: 'SignedOut', sessionEnded: false });
    const profileBefore = await priya.auth.snapshot();
    expect(profileBefore).toMatchObject({ accessToken: null, profile: null, lastState: null });
    // the device set stays (D9), the pairing's owner with it (R9.5)
    expect(await priya.store.load()).toMatchObject({ pairingId: priyaPairingId });
    expect(priya.signer.hasKeys()).toBe(true);
    expect(await priya.queue.waitingCount()).toBe(queued);
    expect(profileBefore.pairingOwnerUserId).toMatch(/^[0-9a-f]{24}$/);
    expect(await pairingStateOf(owner, priyaEmployeeId)).toBe('PAIRED');

    // R9.10: the punch travels with the envelope only; no session exists on the phone right now,
    // and the server never looks for one. Stored with the server time (HR R4.2–R4.4, R5.6–R5.7).
    expect(await priya.auth.accessToken()).toBeNull();
    const result = await punchFlow(priya).run({ directionGuess: 'IN' });
    expect(result.kind).toBe('stored');
    firstPunch = (result as { response: AppPunchResponse }).response;
    expect(firstPunch).toMatchObject({
      outcome: 'STORED',
      direction: 'IN',
      duplicate: false,
      nextDirection: 'OUT',
    });
    expect(firstPunch.flags).toEqual([]);
    expect(firstPunch.atLocal).toMatch(/^\d{2}:\d{2}$/);
    expect((result as { lines: string[] }).lines).toEqual([
      punchConfirmation('IN', firstPunch.atLocal),
    ]);
    // Server clock, not the phone's: within a minute of now
    expect(Math.abs(Date.parse(firstPunch.at) - Date.now())).toBeLessThan(60_000);
    expect(priya.signer.punchSignatures).toBe(1);
    expect(await priya.auth.accessToken()).toBeNull();

    // The same account signs in again: no question, no code, Home with the punch on it (R9.6).
    const again = await priya.account.signIn(priya.credentials);
    expect(await signInOn(priya, again)).toBe('signed_in');
    expect(priya.confirms).toEqual([]);
    expect(await priya.store.load()).toMatchObject({ pairingId: priyaPairingId });
    expect(await priya.auth.pairingOwnerUserId()).toBe(again.userId);
    expect(priya.route).toMatchObject({
      name: 'Home',
      state: {
        state: 'ACTIVE',
        pairing: { state: 'PAIRED', pairingId: priyaPairingId },
        today: { date: kolkataDate(0), in: firstPunch.atLocal, nextDirection: 'OUT' },
      },
    });
    expect(await pairingStateOf(owner, priyaEmployeeId)).toBe('PAIRED');

    // History through the login lists the punch made without one (R7.9).
    const history = await priya.account.history(kolkataDate(0), kolkataDate(0));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      employeeId: priyaEmployeeId,
      direction: 'IN',
      source: 'BIOMETRIC_APP',
      at: firstPunch.at,
      time: firstPunch.atLocal,
      localDate: kolkataDate(0),
    });
  });

  it('replaying the identical request answers the stored result and stores nothing (HR R5.10)', async () => {
    const replay = await priya.client.postPunch(priya.sent[0]);
    expect(replay).toMatchObject({
      outcome: 'REPLAYED',
      direction: firstPunch.direction,
      at: firstPunch.at,
    });
  });

  it('a second tap within 5 minutes is stored as a duplicate (HR R4.8)', async () => {
    const result = await punchFlow(priya).run({ directionGuess: 'OUT' });
    expect(result.kind).toBe('stored');
    const response = (result as { response: AppPunchResponse }).response;
    expect(response).toMatchObject({ outcome: 'DUPLICATE', duplicate: true, nextDirection: 'OUT' });
    expect((result as { lines: string[] }).lines.at(-1)).toBe(DUPLICATE_SENTENCE);
  });

  it('an offline punch is queued, sent by the sync worker and stored with the phone time (HR R6.2–R6.9, R9.4)', async () => {
    const phoneTimeMs = Math.floor((Date.now() - 30 * 60_000) / 1000) * 1000;
    const result = await punchFlow(priya, { offline: true, clock: () => phoneTimeMs }).run({
      directionGuess: 'OUT',
    });
    expect(result.kind).toBe('queued');
    expect(await priya.queue.waitingCount()).toBe(1);

    const states: QueueState[] = [];
    const sync = new SyncWorker({
      queue: priya.queue,
      client: priya.client,
      pairingStore: priya.store,
      history: priya.history,
      onChange: (state) => states.push(state),
    });
    await sync.start();
    await sync.runNow('start');
    sync.stop();

    expect(await priya.queue.waitingCount()).toBe(0);
    expect(await priya.queue.refused()).toEqual([]);
    expect(states.at(-1)).toMatchObject({ waiting: 0, refused: [] });

    const cached = await priya.history.list();
    const offline = cached.find((entry) => entry.flags.includes('RECORDED_OFFLINE'));
    expect(offline).toBeDefined();
    expect(offline?.atMs).toBe(phoneTimeMs);
  });

  it('GET /attendance-app/punches lists the worker\u2019s own punches, newest first, with the flags (HR R4.10, R8.9)', async () => {
    const loaded = await loadHistory({ client: priya.client, cache: priya.history });
    expect(loaded.kind).toBe('server');
    const entries = (loaded as { entries: HistoryEntry[] }).entries;
    expect(entries).toHaveLength(3);
    const times = entries.map((e) => e.atMs);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(entries.filter((e) => e.flags.includes('RECORDED_OFFLINE'))).toHaveLength(1);
    expect(entries.filter((e) => !e.counted)).toHaveLength(1);

    const manager = await api<{ lastPunchAt: string | null }>(
      'GET',
      `/hr/employees/${priyaEmployeeId}/pairing`,
      undefined,
      owner.token,
    );
    expect(manager.lastPunchAt).not.toBeNull();
  });

  it('POST /attendance-app/consent records the agreed version (HR R9.13)', async () => {
    const agreed = await priya.client.postConsent(priyaBootstrap.consentVersion);
    expect(agreed.agreedVersion).toBe(priyaBootstrap.consentVersion);
  });

  it('a request signed by a key the server does not know is refused as not verified (HR R5.7–R5.8)', async () => {
    const intruder = phone(new AuthStore({ storage: memoryStorage() }));
    await intruder.signer.createKeys();
    intruder.forcePairingId(priyaPairingId);
    await expect(intruder.client.getMe()).rejects.toMatchObject({
      status: 422,
      code: 'HR_APP_NOT_VERIFIED',
      serverMessage: SERVER_MESSAGES.HR_APP_NOT_VERIFIED,
    });
    await intruder.db.closeAsync();
  });

  it('a code for another worker is refused word for word and still works for its owner (R7.3)', async () => {
    await createWorker(ravi, 'Ravi Kumar', '9876500022');
    await ravi.account.createJoinRequest(owner.shopId);
    raviEmployeeId = await approveCreate(owner, ravi.credentials.email);
    await ravi.shell.refresh();
    expect(ravi.route).toMatchObject({ name: 'Home', state: { state: 'ACTIVE' } });

    const code = await api<{ code: string; qrPayload: string }>(
      'POST',
      `/hr/employees/${raviEmployeeId}/pairing-codes`,
      undefined,
      owner.token,
    );

    const refused = await priya.workerPairingFlow.submitCode(code.code);
    expect(refused).toEqual({
      kind: 'refused',
      code: 'HR_PAIRING_WRONG_EMPLOYEE',
      message: WORKER_SERVER_MESSAGES.HR_PAIRING_WRONG_EMPLOYEE,
    });
    expect(await pairingStateOf(owner, priyaEmployeeId)).toBe('PAIRED');
    expect(await pairingStateOf(owner, raviEmployeeId)).toBe('NOT_PAIRED');

    const claimed = await ravi.workerPairingFlow.submitCode(code.code);
    expect(claimed.kind).toBe('claimed');
    const claim = (claimed as { claim: ClaimPairingResponse }).claim;
    expect(claim.employeeName).toBe('Ravi Kumar');
    const agreed = await ravi.workerPairingFlow.agree(claim.claimToken, claim.consent.version);
    expect(agreed.kind).toBe('paired');
    expect((agreed as { pairing: PairingBootstrap }).pairing.employeeId).toBe(raviEmployeeId);
    raviPairingId = (agreed as { pairing: PairingBootstrap }).pairing.pairingId;
    expect(await pairingStateOf(owner, raviEmployeeId)).toBe('PAIRED');
    expect(await ravi.auth.pairingOwnerUserId()).toBe((await ravi.auth.profile())?.userId);
  });

  it('a request carrying both credentials is refused before any handler (R9.1)', async () => {
    // Neither client can build such a request, so the shared transport sends it by hand.
    const transport = createTransport({ inferCode: inferAccountErrorCode });
    const token = await priya.auth.accessToken();
    expect(token).not.toBeNull();

    const bearerWithPairing = await catchRefusal(() =>
      transport.send(
        'GET',
        `${BASE_URL}/hr/worker/me`,
        { Authorization: `Bearer ${token}`, [HEADER_PAIRING_ID]: priyaPairingId },
        undefined,
        10_000,
      ),
    );
    expect(bearerWithPairing).toMatchObject({
      status: 400,
      code: 'HR_TWO_CREDENTIALS',
      serverMessage: WORKER_SERVER_MESSAGES.HR_TWO_CREDENTIALS,
    });

    const deviceWithBearer = await catchRefusal(() =>
      transport.send(
        'GET',
        `${BASE_URL}/hr/attendance-app/me`,
        { Authorization: `Bearer ${token}`, [HEADER_PAIRING_ID]: priyaPairingId },
        undefined,
        10_000,
      ),
    );
    expect(deviceWithBearer).toMatchObject({
      status: 400,
      code: 'HR_TWO_CREDENTIALS',
      serverMessage: WORKER_SERVER_MESSAGES.HR_TWO_CREDENTIALS,
    });

    // and the real clients still work after the two refusals: nothing was counted against them
    expect((await priya.account.workerState()).state).toBe('ACTIVE');
    expect((await priya.client.getMe()).canPunch).toBe(true);
  });

  it('signing in with a different account unpairs this phone and warns about the queue, by the recorded owner alone (R9.7)', async () => {
    // One offline punch waits on Priya's phone when Ravi signs in on it.
    const offline = await punchFlow(priya, { offline: true }).run({ directionGuess: 'OUT' });
    expect(offline.kind).toBe('queued');
    expect(await priya.queue.waitingCount()).toBe(1);

    const raviOnPriyasPhone = await priya.account.signIn(ravi.credentials);
    expect(await signInOn(priya, raviOnPriyasPhone)).toBe('signed_in');

    expect(priya.confirms).toHaveLength(1);
    expect(priya.confirms[0].explanation).toContain('1 punch that was not yet sent will be lost');
    expect(await priya.store.load()).toBeNull();
    expect(priya.signer.hasKeys()).toBe(false);
    expect(await priya.queue.waitingCount()).toBe(0);
    // the owner id went with the pairing (R9.5, R11.8)
    expect(await priya.auth.pairingOwnerUserId()).toBeNull();
    expect(await pairingStateOf(owner, priyaEmployeeId)).toBe('NOT_PAIRED');
    expect(await priya.auth.profile()).toMatchObject({ userId: raviOnPriyasPhone.userId });
    // Ravi's state on this phone: his own record, paired on his own phone (R6.1)
    expect(priya.route).toMatchObject({
      name: 'Home',
      state: { employee: { employeeId: raviEmployeeId }, pairing: { state: 'PAIRED' } },
    });

    // Priya signs back in on her phone: another account's data goes, nothing to unpair (R9.6).
    const priyaAgain = await priya.account.signIn(priya.credentials);
    expect(await signInOn(priya, priyaAgain)).toBe('signed_in');
    expect(priya.confirms).toHaveLength(1);
    expect(priya.route).toMatchObject({
      name: 'Home',
      state: { employee: { employeeId: priyaEmployeeId }, pairing: { state: 'NOT_PAIRED' } },
    });
  });

  it('Leave this shop exits the employee today and lands on Join (R5.3)', async () => {
    const left = await priya.account.leaveShop();
    expect(left).toMatchObject({ state: 'NO_SHOP', modules: [] });
    expect(left.shop ?? null).toBeNull();

    // `ShellActions.apply`: route from the answer the screen already holds, no second read
    priya.route = await shellResolve(priya, { kind: 'state', state: left });
    expect(priya.route).toMatchObject({ name: 'Join', state: { state: 'NO_SHOP' } });
    expect(await priya.auth.lastState()).toMatchObject({ state: 'NO_SHOP', modules: [] });

    await priya.shell.refresh();
    expect(priya.route).toMatchObject({ name: 'Join' });

    const employee = await api<{ status: string; exitDate: string | null }>(
      'GET',
      `/hr/employees/${priyaEmployeeId}`,
      undefined,
      owner.token,
    );
    expect(employee).toMatchObject({ status: 'EXITED', exitDate: kolkataDate(0) });

    // the shop is free to ask again (R5.1)
    expect(await priya.account.lookupShops(owner.ownerEmail)).toEqual({
      shops: [{ shopId: owner.shopId, shopName: owner.shopName, ownerFirstName: 'Ramesh' }],
    });
  });

  it('"Remove this phone" unpairs, wipes the phone with the pairing\u2019s owner, and the old pairing then gets 403 (HR R3.2, R3.3, R3.7, R9.6; R7.7)', async () => {
    expect(await ravi.auth.pairingOwnerUserId()).toMatch(/^[0-9a-f]{24}$/);
    const removed = await removePhone({ client: ravi.client, pairingStore: ravi.store });
    expect(removed).toEqual({ kind: 'unpaired' });
    expect(await ravi.store.load()).toBeNull();
    expect(ravi.signer.hasKeys()).toBe(false);
    expect(await ravi.queue.waitingCount()).toBe(0);
    expect(await ravi.auth.pairingOwnerUserId()).toBeNull();
    // the session is kept (R7.7): Home, Attendance not enabled on this phone
    expect(await ravi.auth.accessToken()).not.toBeNull();
    await ravi.shell.refresh();
    expect(ravi.route).toMatchObject({ name: 'Home', state: { pairing: { state: 'NOT_PAIRED' } } });

    // The phone still had the keys cached (say a half-wiped install): the server refuses anyway.
    const stale = phone(new AuthStore({ storage: memoryStorage() }));
    await stale.signer.createKeys();
    stale.forcePairingId(raviPairingId);
    let refusal: unknown;
    try {
      await stale.client.getMe();
    } catch (error) {
      refusal = error;
    }
    expect(isServerRefusal(refusal)).toBe(true);
    const r = refusal as ServerRefusal;
    expect(r.status).toBe(403);
    expect(r.code).toBe('HR_APP_NOT_PAIRED');
    expect(r.notPaired).toBe(true);
    expect(r.serverMessage).toBe(SERVER_MESSAGES.HR_APP_NOT_PAIRED);
    expect(r.message).toBe(refusalText('HR_APP_NOT_PAIRED', SERVER_MESSAGES.HR_APP_NOT_PAIRED));
    await stale.db.closeAsync();

    expect(await pairingStateOf(owner, raviEmployeeId)).toBe('NOT_PAIRED');
  });
});
