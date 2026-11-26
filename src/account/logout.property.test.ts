// Task 14.7 — Property 22 (Log out deletes the account set and keeps the device set; R9.5, R11.8,
// R12.10), run against the real `AuthStore` and `PairingStore` over one in-memory `SecureStorage`,
// and the real `PunchQueue`, `HistoryCache` and `NotificationsCache` over one `MemoryDatabase`, the
// way `src/app/deps.ts` wires them on the phone.
//
// For any contents of the secure store (an account with or without a last state, a dismissed
// outcome and a theme choice; a pairing with or without an installation id and with or without a
// recorded owner), any SQLite contents (waiting and refused punches, history rows, notifications)
// and whatever the server says to `POST /auth/logout`: after `logout()` every `skat.account*` key,
// the history rows and the notification rows are gone, while every other secure-store key (the
// pairing record with its location settings and consent version, the installation id,
// `skat.pairingOwnerUserId`, `skat.themeOverride`) and every `punch_queue` row are byte-identical
// to before, the hardware keys were not deleted, and `resolveTheme(system, override)` still gives
// the override unless it is `system`.
//
// The "account set" is written out here as a prefix rule (`skat.account`), not as `ACCOUNT_KEYS`,
// so a key added to the store but forgotten in the clear list fails this test.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import type {
  AppLocationSettings,
  AppPunchRequest,
  PunchDirection,
} from '@stockkart/attendance-protocol';

import { NotAuthenticated, NotReachable, ServerRefusal } from '../api/transport';
import {
  HistoryCache,
  PUNCH_HISTORY_META_TABLE,
  PUNCH_HISTORY_TABLE,
} from '../history/HistoryCache';
import { NOTIFICATIONS_CACHE_TABLE, PUNCH_QUEUE_TABLE } from '../queue/db';
import { MemoryDatabase } from '../queue/memoryDb';
import { PunchQueue } from '../queue/PunchQueue';
import {
  ACCOUNT_KEYS,
  AuthStore,
  PAIRING_OWNER_KEY,
  THEME_OVERRIDE_KEY,
  type StoredAccount,
  type StoredWorkerState,
} from '../state/authStore';
import { NotificationsCache, type CachedNotification } from '../state/NotificationsCache';
import {
  INSTALLATION_ID_KEY,
  PAIRING_KEY,
  PairingStore,
  type PairingRecord,
  type SecureStorage,
} from '../state/pairingStore';
import { resolveTheme, type SystemScheme, type ThemeOverride } from '../theme/useTheme';
import { logout } from './logout';

// Both stores share the `expo-secure-store` adapter at module load; the tests inject memory storage.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => '0f8fad5b-d9cb-469f-a165-70867728950e' }));

const NUM_RUNS = 150;
const ACCOUNT_PREFIX = 'skat.account';
const NOW_MS = Date.UTC(2025, 4, 12, 8, 0, 0);

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

const objectId = fc.stringMatching(/^[0-9a-f]{24}$/);
const shortText = fc.stringMatching(/^[A-Za-z][A-Za-z .'-]{0,24}$/);
const hhmm = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
const direction = fc.constantFrom<PunchDirection>('IN', 'OUT');
const themeOverride = fc.constantFrom<ThemeOverride>('system', 'light', 'dark');
const systemScheme = fc.constantFrom<SystemScheme>('light', 'dark', 'unspecified', null, undefined);

const account: fc.Arbitrary<StoredAccount> = fc.record(
  {
    accessToken: fc.stringMatching(/^[A-Za-z0-9._-]{8,80}$/),
    userId: objectId,
    name: shortText,
    email: fc.emailAddress(),
    phone: fc.stringMatching(/^[6-9][0-9]{9}$/),
    photoUrl: objectId.map((id) => `/api/v1/users/${id}/photo`),
    role: fc.constantFrom('WORKER', 'OWNER', 'MANAGER', 'CASHIER'),
  },
  { requiredKeys: ['accessToken', 'userId', 'name', 'email', 'role'] },
);

const lastState: fc.Arbitrary<StoredWorkerState> = fc.record(
  {
    state: fc.constantFrom<StoredWorkerState['state']>(
      'NO_SHOP',
      'PENDING',
      'ACTIVE',
      'STAFF_NO_EMPLOYEE',
    ),
    modules: fc.subarray(['ATTENDANCE', 'HISTORY', 'PROFILE']),
    shop: fc.record({ shopId: objectId, shopName: shortText }),
    employee: fc.record({
      employeeId: objectId,
      code: fc.stringMatching(/^EMP-[0-9]{3}$/),
      name: shortText,
      joinDate: fc.constant('2025-04-03'),
      status: fc.constantFrom('ACTIVE' as const, 'EXITED' as const),
    }),
    pairing: fc.oneof(
      fc.constant({ state: 'NOT_PAIRED' as const }),
      objectId.map((pairingId) => ({ state: 'PAIRED' as const, pairingId })),
    ),
    today: fc.record({
      date: fc.constant('2025-05-12'),
      in: hhmm,
      out: hhmm,
      nextDirection: direction,
    }),
    serverTime: fc.constant('2025-05-12T08:00:00Z'),
  },
  { requiredKeys: ['state', 'modules'] },
);

const location: fc.Arbitrary<AppLocationSettings> = fc.oneof(
  fc.constant({ locationCheck: false }),
  fc.record({
    locationCheck: fc.constant(true),
    shopLat: fc.double({ min: 8, max: 35, noNaN: true }),
    shopLng: fc.double({ min: 68, max: 97, noNaN: true }),
    radiusMetres: fc.integer({ min: 50, max: 2000 }),
    outsideAction: fc.constantFrom('FLAG' as const, 'BLOCK' as const),
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

/** What the server may say to `POST /auth/logout`; none of it stops the log out. */
type LogoutAnswer =
  | { kind: 'ok' }
  | { kind: 'not_reachable' }
  | { kind: 'refused' }
  | { kind: 'not_authenticated' };

const logoutAnswer = fc.constantFrom<LogoutAnswer>(
  { kind: 'ok' },
  { kind: 'not_reachable' },
  { kind: 'refused' },
  { kind: 'not_authenticated' },
);

/** A phone's whole contents before log out. */
const phoneContents = fc.record({
  account: fc.option(account, { nil: null }),
  lastState: fc.option(lastState, { nil: null }),
  dismissedOutcomeId: fc.option(objectId, { nil: null }),
  /** The account the pairing was made under; drawn apart from `account` (R9.5 keeps it either way). */
  pairingOwnerUserId: fc.option(objectId, { nil: null }),
  theme: fc.option(themeOverride, { nil: null }),
  pairing: fc.option(pairing, { nil: null }),
  withInstallationId: fc.boolean(),
  /** Waiting punches first, then how many of the first rows the server has refused. */
  queued: fc.integer({ min: 0, max: 5 }),
  refused: fc.integer({ min: 0, max: 2 }),
  history: fc.integer({ min: 0, max: 5 }),
  notifications: fc.array(
    fc.record({
      text: shortText,
      type: fc.constantFrom('JOIN_REQUEST_APPROVED', 'JOIN_REQUEST_REJECTED', 'PROFILE_REQUESTED'),
      read: fc.boolean(),
    }),
    { maxLength: 5 },
  ),
  answer: logoutAnswer,
  system: systemScheme,
});

type PhoneContents = typeof phoneContents extends fc.Arbitrary<infer T> ? T : never;

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

function punch(n: number, pairing: PairingRecord | null): AppPunchRequest {
  return {
    pairingId: pairing?.pairingId ?? '66f1a2b3c4d5e6f708192a3c',
    shopId: pairing?.shopId ?? '5f1a2b3c4d5e6f7081920001',
    employeeId: pairing?.employeeId ?? '5f1a2b3c4d5e6f7081920002',
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

function serverAnswer(answer: LogoutAnswer): Promise<{ success: boolean }> {
  switch (answer.kind) {
    case 'ok':
      return Promise.resolve({ success: true });
    case 'not_reachable':
      return Promise.reject(new NotReachable('CONNECTION'));
    case 'refused':
      return Promise.reject(new ServerRefusal(429, 'Too many attempts, try again later'));
    case 'not_authenticated':
      return Promise.reject(new NotAuthenticated('Session expired'));
  }
}

/** Builds the phone from generated contents, the way `src/app/deps.ts` wires the stores. */
async function phone(contents: PhoneContents) {
  const { storage, map } = memoryStorage();
  const db = new MemoryDatabase();
  const queue = new PunchQueue(db, { now: () => NOW_MS });
  const historyCache = new HistoryCache(db, { now: () => NOW_MS });
  const notificationsCache = new NotificationsCache(db);
  const keys = { deleted: 0 };
  const authStore = new AuthStore({
    storage,
    clearCaches: async () => {
      await historyCache.clear();
      await notificationsCache.clear();
    },
  });
  const pairingStore = new PairingStore({
    storage,
    deleteKeys: async () => {
      keys.deleted += 1;
    },
    deleteQueue: () => queue.clear(),
    forgetOwner: () => authStore.clearPairingOwner(),
  });

  if (contents.account) {
    await authStore.saveAccount(contents.account);
  }
  if (contents.lastState) {
    await authStore.saveLastState(contents.lastState);
  }
  await authStore.setDismissedOutcomeId(contents.dismissedOutcomeId);
  if (contents.pairingOwnerUserId) {
    await authStore.setPairingOwnerUserId(contents.pairingOwnerUserId);
  }
  if (contents.theme) {
    await authStore.setThemeOverride(contents.theme);
  }
  if (contents.pairing) {
    await pairingStore.save(contents.pairing);
  }
  if (contents.withInstallationId) {
    await pairingStore.installationId();
  }
  // The phone opens the queue file (and with it the two caches) before anything else; here that
  // creates the tables so an empty one can be dumped like a full one.
  await queue.waitingCount();
  await historyCache.count();
  await notificationsCache.count();
  const refused = Math.min(contents.refused, contents.queued);
  for (let n = 1; n <= contents.queued; n++) {
    await queue.enqueue(punch(n, contents.pairing), n % 2 === 0 ? 'OUT' : 'IN');
    if (n <= refused) {
      await queue.markRefused(punch(n, contents.pairing).punchId, 'Fake location detected');
    }
  }
  if (contents.history > 0) {
    await historyCache.replaceAll(
      Array.from({ length: contents.history }, (_, i) => ({
        punchId: `7c9e6679-7425-40de-944b-${String(i).padStart(12, '0')}`,
        atMs: NOW_MS - i * 3_600_000,
        localDate: '2025-05-12',
        localTime: `${String(13 - i).padStart(2, '0')}:30`,
        direction: i % 2 === 0 ? 'IN' : 'OUT',
        flags: i === 0 ? ['RECORDED_OFFLINE'] : [],
        counted: true,
      })),
      '2025-04-12',
    );
  }
  if (contents.notifications.length > 0) {
    await notificationsCache.replaceAll(
      contents.notifications.map(
        (item, i): CachedNotification => ({
          id: `n${i}`,
          text: item.text,
          type: item.type,
          createdAt: `2025-05-${String(1 + i).padStart(2, '0')}T08:00:00Z`,
          read: item.read,
        }),
      ),
    );
  }

  const account = { logout: vi.fn(() => serverAnswer(contents.answer)) };
  const shell = { refresh: vi.fn(async () => undefined) };
  return {
    map,
    db,
    queue,
    historyCache,
    notificationsCache,
    keys,
    pairingStore,
    authStore,
    account,
    shell,
    /** Rows the server has not refused: what `waitingCount` must say before and after. */
    waiting: contents.queued - refused,
  };
}

/** The secure store minus the account set: the keys log out must leave byte-identical. */
function deviceSet(map: Map<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of map) {
    if (!key.startsWith(ACCOUNT_PREFIX)) {
      kept[key] = value;
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------------------------
// Property 22
// ---------------------------------------------------------------------------------------------

describe('Feature: worker-app, Property 22: Log out deletes the account set and keeps the device set', () => {
  it('for any secure-store, queue and cache contents and any server answer: every skat.account* key, the history rows and the notification rows are gone; the pairing record, installation id, keys, waiting punches, pairing owner and theme choice are byte-identical; the server is told once and the shell re-reads once (R9.5, R11.8, R12.10)', async () => {
    await fc.assert(
      fc.asyncProperty(phoneContents, async (contents) => {
        const p = await phone(contents);

        // The account set is the four `skat.account*` keys and nothing else; the design's keep-set
        // is everything else in the store. Both are read before the log out.
        const accountKeysBefore = [...p.map.keys()].filter((k) => k.startsWith(ACCOUNT_PREFIX));
        expect(accountKeysBefore.every((k) => ACCOUNT_KEYS.includes(k))).toBe(true);
        const deviceBefore = deviceSet(p.map);
        const queueBefore = p.db.dump(PUNCH_QUEUE_TABLE);
        const keysDeletedBefore = p.keys.deleted;
        const themeBefore = await p.authStore.themeOverride();

        await logout({ account: p.account, authStore: p.authStore }, p.shell);

        // Account set: gone (R9.5, R11.8), through the store and as the store reads itself.
        expect([...p.map.keys()].filter((k) => k.startsWith(ACCOUNT_PREFIX))).toEqual([]);
        const snapshot = await p.authStore.snapshot();
        expect(snapshot.accessToken).toBeNull();
        expect(snapshot.profile).toBeNull();
        expect(snapshot.lastState).toBeNull();
        expect(snapshot.dismissedOutcomeId).toBeNull();
        expect(p.db.dump(PUNCH_HISTORY_TABLE)).toEqual([]);
        expect(p.db.dump(PUNCH_HISTORY_META_TABLE)).toEqual([]);
        expect(p.db.dump(NOTIFICATIONS_CACHE_TABLE)).toEqual([]);
        expect(await p.historyCache.list()).toEqual([]);
        expect(await p.historyCache.fetchedAt()).toBeNull();
        expect(await p.notificationsCache.list()).toEqual([]);

        // Device set: byte-identical (D9). The pairing record carries the location settings and
        // the consent version; the queue table carries every waiting and refused punch.
        expect(deviceSet(p.map)).toEqual(deviceBefore);
        expect(p.map.get(PAIRING_KEY)).toBe(deviceBefore[PAIRING_KEY]);
        expect(p.map.get(INSTALLATION_ID_KEY)).toBe(deviceBefore[INSTALLATION_ID_KEY]);
        expect(await p.pairingStore.load()).toEqual(contents.pairing);
        expect(p.keys.deleted).toBe(keysDeletedBefore);
        expect(p.db.dump(PUNCH_QUEUE_TABLE)).toEqual(queueBefore);
        expect(await p.queue.waitingCount()).toBe(p.waiting);

        // The pairing's owner survives with the pairing (R9.5): the next sign-in reads it.
        expect(p.map.get(PAIRING_OWNER_KEY)).toBe(deviceBefore[PAIRING_OWNER_KEY]);
        expect(snapshot.pairingOwnerUserId).toBe(contents.pairingOwnerUserId);
        expect(await p.authStore.pairingOwnerUserId()).toBe(contents.pairingOwnerUserId);

        // The theme choice survives and still resolves the same way (R12.10).
        expect(p.map.get(THEME_OVERRIDE_KEY)).toBe(deviceBefore[THEME_OVERRIDE_KEY]);
        const themeAfter = await p.authStore.themeOverride();
        expect(themeAfter).toBe(themeBefore);
        expect(themeAfter).toBe(contents.theme ?? 'system');
        const resolved = resolveTheme(contents.system, themeAfter);
        if (themeAfter === 'system') {
          expect(resolved).toBe(contents.system === 'dark' ? 'dark' : 'light');
        } else {
          expect(resolved).toBe(themeAfter);
        }

        // Server first, once, whatever it says; then the shell, once.
        expect(p.account.logout).toHaveBeenCalledTimes(1);
        expect(p.shell.refresh).toHaveBeenCalledTimes(1);
        expect(p.account.logout.mock.invocationCallOrder[0]).toBeLessThan(
          p.shell.refresh.mock.invocationCallOrder[0],
        );
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);

  it('for any phone, a second log out changes nothing more: the device set stays byte-identical and the account set stays empty', async () => {
    await fc.assert(
      fc.asyncProperty(phoneContents, async (contents) => {
        const p = await phone(contents);
        await logout({ account: p.account, authStore: p.authStore }, p.shell);
        const deviceAfterFirst = deviceSet(p.map);
        const queueAfterFirst = p.db.dump(PUNCH_QUEUE_TABLE);

        await logout({ account: p.account, authStore: p.authStore }, p.shell);

        expect([...p.map.keys()].filter((k) => k.startsWith(ACCOUNT_PREFIX))).toEqual([]);
        expect(deviceSet(p.map)).toEqual(deviceAfterFirst);
        expect(p.db.dump(PUNCH_QUEUE_TABLE)).toEqual(queueAfterFirst);
        expect(p.keys.deleted).toBe(0);
        expect(p.shell.refresh).toHaveBeenCalledTimes(2);
      }),
      { numRuns: 50 },
    );
  }, 60_000);
});
