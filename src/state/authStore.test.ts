import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryCache } from '../history/HistoryCache';
import { MemoryDatabase } from '../queue/memoryDb';
import {
  ACCOUNT_KEY,
  ACCOUNT_KEYS,
  AuthStore,
  DISMISSED_OUTCOME_KEY,
  LAST_STATE_KEY,
  MAX_SECURE_VALUE_BYTES,
  KEPT_ON_LOGOUT_KEYS,
  PAIRING_OWNER_KEY,
  THEME_OVERRIDE_KEY,
  TOKEN_KEY,
  toStoredState,
  utf8Length,
  type StoredAccount,
  type StoredWorkerState,
  type WorkerStateLike,
} from './authStore';
import { NotificationsCache } from './NotificationsCache';
import { INSTALLATION_ID_KEY, PAIRING_KEY, type SecureStorage } from './pairingStore';

// `pairingStore` (the shared secure-store adapter) imports the Expo modules; the store is tested
// through its injected adapter (vi.mock is hoisted above the imports).
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

/** In-memory `SecureStorage` that records every call. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const calls: string[] = [];
  const storage: SecureStorage = {
    async getItem(key) {
      calls.push(`get ${key}`);
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      calls.push(`set ${key}`);
      map.set(key, value);
    },
    async deleteItem(key) {
      calls.push(`delete ${key}`);
      map.delete(key);
    },
  };
  return { storage, map, calls };
}

const account: StoredAccount = {
  accessToken: 'tok.en.value',
  userId: '66f1a2b3c4d5e6f708192a3b',
  name: 'Priya Sharma',
  email: 'priya@example.com',
  phone: '9876543210',
  photoUrl: 'https://api.test.invalid/api/v1/users/66f1a2b3c4d5e6f708192a3b/photo',
  role: 'WORKER',
};

const activeState: StoredWorkerState = {
  state: 'ACTIVE',
  shop: { shopId: '5f1a2b3c4d5e6f7081920001', shopName: 'Sri Ganesh Stores' },
  employee: {
    employeeId: '5f1a2b3c4d5e6f7081920002',
    code: 'EMP-015',
    name: 'Priya Sharma',
    joinDate: '2025-04-03',
    status: 'ACTIVE',
  },
  modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
  pairing: { state: 'PAIRED', pairingId: '66f1a2b3c4d5e6f708192a3c' },
  today: { date: '2025-04-03', in: '09:12', nextDirection: 'OUT' },
  serverTime: '2025-04-03T03:42:08Z',
};

describe('AuthStore', () => {
  let mem: ReturnType<typeof memoryStorage>;
  let store: AuthStore;

  beforeEach(() => {
    mem = memoryStorage();
    store = new AuthStore({ storage: mem.storage });
  });

  describe('account and token', () => {
    it('is empty when nothing is stored', async () => {
      expect(await store.accessToken()).toBeNull();
      expect(await store.profile()).toBeNull();
      expect(await store.account()).toBeNull();
      expect(await store.snapshot()).toEqual({
        accessToken: null,
        profile: null,
        lastState: null,
        dismissedOutcomeId: null,
        themeOverride: 'system',
        pairingOwnerUserId: null,
      });
    });

    it('round-trips the account, with the token on its own key and the profile before it', async () => {
      await store.saveAccount(account);
      expect(await store.account()).toEqual(account);
      expect(await store.accessToken()).toBe('tok.en.value');
      expect(mem.map.get(TOKEN_KEY)).toBe('tok.en.value');
      expect(mem.map.get(ACCOUNT_KEY)).not.toContain('tok.en.value');
      expect(Object.keys(JSON.parse(String(mem.map.get(ACCOUNT_KEY)))).sort()).toEqual(
        ['email', 'name', 'phone', 'photoUrl', 'role', 'userId'].sort(),
      );
      expect(mem.calls.filter((c) => c.startsWith('set'))).toEqual([
        `set ${ACCOUNT_KEY}`,
        `set ${TOKEN_KEY}`,
      ]);
    });

    it('drops extra fields the server might add and omits an absent phone or photo (R9.2)', async () => {
      const { phone: _phone, photoUrl: _photo, ...staff } = account;
      await store.saveAccount({ ...staff, role: 'MANAGER', password: 'never' } as StoredAccount);
      expect(mem.map.get(ACCOUNT_KEY)).not.toContain('never');
      expect(await store.profile()).toEqual({
        userId: account.userId,
        name: account.name,
        email: account.email,
        role: 'MANAGER',
      });
    });

    it('refuses an incomplete account and stores nothing', async () => {
      await expect(store.saveAccount({ ...account, userId: '' })).rejects.toThrow(/incomplete/);
      await expect(store.saveAccount({ ...account, accessToken: '' })).rejects.toThrow(/token/);
      expect(mem.map.size).toBe(0);
    });

    it('treats a corrupt profile as absent and removes it', async () => {
      mem.map.set(ACCOUNT_KEY, '{not json');
      mem.map.set(TOKEN_KEY, 'tok');
      expect(await store.profile()).toBeNull();
      expect(await store.account()).toBeNull();
      expect(mem.map.has(ACCOUNT_KEY)).toBe(false);
      mem.map.set(ACCOUNT_KEY, JSON.stringify({ userId: 'x' }));
      expect(await store.profile()).toBeNull();
    });

    it('updateProfile changes name, phone and photo in place and needs a profile', async () => {
      await expect(store.updateProfile({ name: 'X' })).rejects.toThrow(/not signed in/);
      await store.saveAccount(account);
      const next = await store.updateProfile({ name: 'Priya S', phone: '9000000000' });
      expect(next).toEqual({ ...toProfileOf(account), name: 'Priya S', phone: '9000000000' });
      expect(await store.profile()).toEqual(next);
      expect(await store.accessToken()).toBe('tok.en.value');
    });

    it('saveAccessToken replaces the token alone', async () => {
      await store.saveAccount(account);
      await store.saveAccessToken('fresh');
      expect(await store.account()).toEqual({ ...account, accessToken: 'fresh' });
      await expect(store.saveAccessToken('')).rejects.toThrow(/empty/);
    });

    it('the phone the state machine reads: absent for an account stored without one, added by the phone step, dropped again when blank (R1.11, DD20)', async () => {
      const { phone: _phone, ...withoutPhone } = account;
      await store.saveAccount(withoutPhone as StoredAccount);
      expect((await store.snapshot()).profile?.phone).toBeUndefined();
      expect(await store.profile()).not.toHaveProperty('phone');

      // The phone step (`update` mode) saves the phone on the profile after `PUT /users/me/profile`.
      await store.updateProfile({ phone: '9123456780' });
      expect((await store.snapshot()).profile?.phone).toBe('9123456780');
      expect(await store.account()).toEqual({ ...withoutPhone, phone: '9123456780' });

      // A `/me` answer with no phone (`useAppState` refresh) removes it rather than storing ''.
      await store.updateProfile({ phone: undefined });
      expect(await store.profile()).not.toHaveProperty('phone');
      await store.updateProfile({ phone: '' });
      expect(await store.profile()).not.toHaveProperty('phone');
      expect(mem.map.get(ACCOUNT_KEY)).not.toContain('phone');
    });
  });

  describe('last state (R6.7)', () => {
    it('round-trips a state and stores neither notifications nor account', async () => {
      const answer = {
        ...activeState,
        account: { userId: account.userId, name: 'Priya Sharma' },
        notifications: { unread: 2, top: [{ id: 'n1', text: 'Sri Ganesh Stores accepted you' }] },
        futureField: 'ignored',
      } as WorkerStateLike;
      await store.saveLastState(answer);
      expect(await store.lastState()).toEqual(activeState);
      const raw = String(mem.map.get(LAST_STATE_KEY));
      expect(raw).not.toContain('notifications');
      expect(raw).not.toContain('accepted you');
      expect(raw).not.toContain('"account"');
      expect(raw).not.toContain('futureField');
    });

    it('keeps the pending request and the last outcome for the Join and Waiting screens', async () => {
      const pending: StoredWorkerState = {
        state: 'PENDING',
        modules: [],
        request: {
          id: 'r1',
          shopName: 'Sri Ganesh Stores',
          requestedAt: '2025-04-01T04:00:00Z',
          status: 'PENDING',
        },
      };
      await store.saveLastState(pending);
      expect(await store.lastState()).toEqual(pending);
      const rejected: StoredWorkerState = {
        state: 'NO_SHOP',
        modules: [],
        lastOutcome: {
          id: 'r1',
          status: 'REJECTED',
          shopName: 'Sri Ganesh Stores',
          reason: 'We are not hiring',
          decidedAt: '2025-04-02T04:00:00Z',
        },
      };
      await store.saveLastState(rejected);
      expect(await store.lastState()).toEqual(rejected);
    });

    it('refuses an unknown state name and treats a corrupt record as absent', async () => {
      await expect(
        store.saveLastState({ state: 'LIMBO', modules: [] } as unknown as WorkerStateLike),
      ).rejects.toThrow(/incomplete/);
      mem.map.set(LAST_STATE_KEY, JSON.stringify({ state: 'ACTIVE' }));
      expect(await store.lastState()).toBeNull();
      expect(mem.map.has(LAST_STATE_KEY)).toBe(false);
    });

    it('a state with every field at its longest fits the Android 2 KB value limit', () => {
      const longest: StoredWorkerState = {
        state: 'NO_SHOP',
        modules: ['ATTENDANCE', 'HISTORY', 'PROFILE', 'PAYSLIPS', 'LEAVE', 'ADVANCES'],
        request: {
          id: '66f1a2b3c4d5e6f708192a3b',
          shopName: 'S'.repeat(100),
          requestedAt: '2025-04-01T04:00:00.123456Z',
          status: 'PENDING',
        },
        lastOutcome: {
          id: '66f1a2b3c4d5e6f708192a3b',
          status: 'REJECTED',
          shopName: 'S'.repeat(100),
          reason: 'R'.repeat(200),
          decidedAt: '2025-04-02T04:00:00.123456Z',
        },
        shop: { shopId: '5f1a2b3c4d5e6f7081920001', shopName: 'S'.repeat(100) },
        employee: {
          employeeId: '5f1a2b3c4d5e6f7081920002',
          code: 'E'.repeat(20),
          name: 'N'.repeat(100),
          joinDate: '2025-04-03',
          status: 'ACTIVE',
        },
        pairing: { state: 'PAIRED', pairingId: '66f1a2b3c4d5e6f708192a3c' },
        today: { date: '2025-04-03', in: '09:12', out: '18:05', nextDirection: 'IN' },
        serverTime: '2025-04-03T03:42:08.123456Z',
      };
      expect(utf8Length(JSON.stringify(toStoredState(longest)))).toBeLessThan(
        MAX_SECURE_VALUE_BYTES,
      );
    });

    it('refuses a value over the 2 KB limit before it reaches the store', async () => {
      const huge: StoredWorkerState = { state: 'NO_SHOP', modules: ['M'.repeat(2100)] };
      await expect(store.saveLastState(huge)).rejects.toThrow(/2048/);
      expect(mem.map.has(LAST_STATE_KEY)).toBe(false);
    });
  });

  describe('flags', () => {
    it('dismissed outcome id is set, read and removed', async () => {
      await store.setDismissedOutcomeId('r1');
      expect(await store.dismissedOutcomeId()).toBe('r1');
      await store.setDismissedOutcomeId(null);
      expect(await store.dismissedOutcomeId()).toBeNull();
      expect(mem.map.has(DISMISSED_OUTCOME_KEY)).toBe(false);
    });

    it('theme override defaults to system, round-trips, and drops an unknown value (R12.10)', async () => {
      expect(await store.themeOverride()).toBe('system');
      await store.setThemeOverride('dark');
      expect(await store.themeOverride()).toBe('dark');
      expect(mem.map.get(THEME_OVERRIDE_KEY)).toBe('dark');
      mem.map.set(THEME_OVERRIDE_KEY, 'sepia');
      expect(await store.themeOverride()).toBe('system');
      expect(mem.map.has(THEME_OVERRIDE_KEY)).toBe(false);
      await expect(store.setThemeOverride('sepia' as never)).rejects.toThrow(/theme override/);
    });

    it('the pairing owner round-trips, refuses an empty id and is removable (R9.5, R9.7)', async () => {
      expect(await store.pairingOwnerUserId()).toBeNull();
      await store.setPairingOwnerUserId(account.userId);
      expect(await store.pairingOwnerUserId()).toBe(account.userId);
      expect(mem.map.get(PAIRING_OWNER_KEY)).toBe(account.userId);
      await expect(store.setPairingOwnerUserId('')).rejects.toThrow(/empty/);
      await store.clearPairingOwner();
      expect(await store.pairingOwnerUserId()).toBeNull();
      expect(mem.map.has(PAIRING_OWNER_KEY)).toBe(false);
      // Clearing twice is fine (`PairingStore.wipe()` may run it on an already-clean phone).
      await store.clearPairingOwner();
    });
  });

  describe('clearSession (R9.3)', () => {
    it('removes the token and nothing else', async () => {
      await store.saveAccount(account);
      await store.saveLastState(activeState);
      await store.setDismissedOutcomeId('r1');
      await store.setThemeOverride('light');
      await store.setPairingOwnerUserId(account.userId);
      mem.map.set(PAIRING_KEY, '{pairing}');
      mem.map.set(INSTALLATION_ID_KEY, 'uuid');
      const before = new Map(mem.map);

      await store.clearSession();

      expect(await store.accessToken()).toBeNull();
      expect(await store.account()).toBeNull();
      before.delete(TOKEN_KEY);
      expect(mem.map).toEqual(before);
      expect(await store.profile()).toEqual(toProfileOf(account));
      expect(await store.lastState()).toEqual(activeState);
    });

    it('leaves the caches alone, and a fresh token makes the account whole again', async () => {
      const clearCaches = vi.fn(async () => undefined);
      const s = new AuthStore({ storage: mem.storage, clearCaches });
      await s.saveAccount(account);
      await s.saveLastState(activeState);

      await s.clearSession();
      expect(clearCaches).not.toHaveBeenCalled();
      expect(mem.calls.filter((c) => c.startsWith('delete'))).toEqual([`delete ${TOKEN_KEY}`]);

      await s.saveAccessToken('fresh-after-sign-in');
      expect(await s.account()).toEqual({ ...account, accessToken: 'fresh-after-sign-in' });
      expect(await s.lastState()).toEqual(activeState);
    });
  });

  describe('keys', () => {
    it('stores under skat.account*, the theme and the pairing owner under their own keys, and clearForLogout lists every account key but those two', async () => {
      expect(ACCOUNT_KEY).toBe('skat.account');
      expect(TOKEN_KEY).toBe('skat.account.token');
      expect(LAST_STATE_KEY).toBe('skat.account.lastState');
      expect(DISMISSED_OUTCOME_KEY).toBe('skat.account.dismissedOutcome');
      expect(PAIRING_OWNER_KEY).toBe('skat.pairingOwnerUserId');
      expect(THEME_OVERRIDE_KEY).toBe('skat.themeOverride');
      expect([...ACCOUNT_KEYS].sort()).toEqual(
        [TOKEN_KEY, ACCOUNT_KEY, LAST_STATE_KEY, DISMISSED_OUTCOME_KEY].sort(),
      );
      expect([...KEPT_ON_LOGOUT_KEYS].sort()).toEqual(
        [PAIRING_OWNER_KEY, THEME_OVERRIDE_KEY].sort(),
      );
      expect(ACCOUNT_KEYS).not.toContain(THEME_OVERRIDE_KEY);
      expect(ACCOUNT_KEYS).not.toContain(PAIRING_OWNER_KEY);
      for (const key of ACCOUNT_KEYS) {
        expect(key.startsWith('skat.account')).toBe(true);
      }

      await store.saveAccount(account);
      await store.saveLastState(activeState);
      await store.setDismissedOutcomeId('r1');
      await store.setPairingOwnerUserId(account.userId);
      await store.setThemeOverride('light');
      expect([...mem.map.keys()].sort()).toEqual([...ACCOUNT_KEYS, ...KEPT_ON_LOGOUT_KEYS].sort());
    });
  });

  describe('clearForLogout (R9.5, R11.8, R12.10)', () => {
    async function filled() {
      const db = new MemoryDatabase();
      const history = new HistoryCache(db, { now: () => 1_700_000_000_000 });
      const notifications = new NotificationsCache(db);
      const clearCaches = vi.fn(async () => {
        await history.clear();
        await notifications.clear();
      });
      const s = new AuthStore({ storage: mem.storage, clearCaches });
      await s.saveAccount(account);
      await s.saveLastState(activeState);
      await s.setDismissedOutcomeId('r1');
      await s.setThemeOverride('dark');
      await s.setPairingOwnerUserId(account.userId);
      await history.replaceAll(
        [
          {
            punchId: 'p1',
            atMs: 1_700_000_000_000,
            localDate: '2023-11-15',
            localTime: '04:03',
            direction: 'IN',
            flags: [],
            counted: true,
          },
        ],
        '2000-01-01',
      );
      await notifications.replaceAll([
        {
          id: 'n1',
          text: 'Sri Ganesh Stores accepted you',
          type: 'JOIN_REQUEST_APPROVED',
          createdAt: '2025-04-03T03:42:08Z',
          read: false,
        },
      ]);
      // The device set, written by other stores, must stay (D9).
      mem.map.set(PAIRING_KEY, '{pairing}');
      mem.map.set(INSTALLATION_ID_KEY, 'uuid');
      return { s, history, notifications, clearCaches };
    }

    it('deletes every account key and empties both caches; keeps the theme, the pairing owner and the device set', async () => {
      const { s, history, notifications, clearCaches } = await filled();

      await s.clearForLogout();

      for (const key of ACCOUNT_KEYS) {
        expect(mem.map.has(key)).toBe(false);
      }
      expect([...mem.map.keys()].sort()).toEqual(
        [THEME_OVERRIDE_KEY, PAIRING_OWNER_KEY, PAIRING_KEY, INSTALLATION_ID_KEY].sort(),
      );
      expect(await s.themeOverride()).toBe('dark');
      expect(await s.pairingOwnerUserId()).toBe(account.userId);
      expect(mem.map.get(PAIRING_KEY)).toBe('{pairing}');
      expect(clearCaches).toHaveBeenCalledTimes(1);
      expect(await history.count()).toBe(0);
      expect(await history.fetchedAt()).toBeNull();
      expect(await notifications.count()).toBe(0);
      expect(await s.snapshot()).toEqual({
        accessToken: null,
        profile: null,
        lastState: null,
        dismissedOutcomeId: null,
        themeOverride: 'dark',
        pairingOwnerUserId: account.userId,
      });
    });

    it('is safe to call twice, including when nothing was stored', async () => {
      const clearCaches = vi.fn(async () => undefined);
      const s = new AuthStore({ storage: mem.storage, clearCaches });
      await s.clearForLogout();
      await s.clearForLogout();
      expect(mem.map.size).toBe(0);
      expect(clearCaches).toHaveBeenCalledTimes(2);
    });

    it('runs every step even when one fails, then rethrows the first failure', async () => {
      const clearCaches = vi.fn(async () => {
        throw new Error('sqlite busy');
      });
      const failing = new AuthStore({ storage: mem.storage, clearCaches });
      await failing.saveAccount(account);
      await failing.setThemeOverride('light');

      await expect(failing.clearForLogout()).rejects.toThrow('sqlite busy');

      expect(mem.map.has(TOKEN_KEY)).toBe(false);
      expect(mem.map.has(ACCOUNT_KEY)).toBe(false);
      expect(mem.map.get(THEME_OVERRIDE_KEY)).toBe('light');
    });
  });
});

describe('utf8Length', () => {
  it('counts bytes, not code units', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('प्रिया')).toBe(18);
    expect(utf8Length('😀')).toBe(4);
  });
});

function toProfileOf(a: StoredAccount) {
  const { accessToken: _token, ...profile } = a;
  return profile;
}
