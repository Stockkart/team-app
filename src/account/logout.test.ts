import { describe, expect, it, vi } from 'vitest';

import type { AppPunchRequest } from '@stockkart/attendance-protocol';

import { NotReachable } from '../api/transport';
import { HistoryCache } from '../history/HistoryCache';
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
import { NotificationsCache } from '../state/NotificationsCache';
import {
  INSTALLATION_ID_KEY,
  PAIRING_KEY,
  PairingStore,
  type PairingRecord,
  type SecureStorage,
} from '../state/pairingStore';
import { logout } from './logout';

// Both stores share the `expo-secure-store` adapter at module load; the tests inject memory storage.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

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

const ACCOUNT: StoredAccount = {
  accessToken: 'tok.en',
  userId: '66f1a2b3c4d5e6f708192a3b',
  name: 'Priya Sharma',
  email: 'priya@example.in',
  phone: '9876543210',
  photoUrl: '/api/v1/users/66f1a2b3c4d5e6f708192a3b/photo',
  role: 'WORKER',
};

const ACTIVE: StoredWorkerState = {
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
  serverTime: '2025-05-12T08:00:00Z',
};

const PAIRING: PairingRecord = {
  pairingId: '66f1a2b3c4d5e6f708192a3c',
  shopId: '5f1a2b3c4d5e6f7081920001',
  employeeId: '5f1a2b3c4d5e6f7081920002',
  employeeName: 'Priya Sharma',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: true, shopLat: 12.97, shopLng: 77.59, radiusMetres: 150 },
  consentVersion: 2,
};

const PUNCH: AppPunchRequest = {
  pairingId: PAIRING.pairingId,
  shopId: PAIRING.shopId,
  employeeId: PAIRING.employeeId,
  punchId: '0f6b2c1e-9c4a-4a5e-8f1d-000000000001',
  phoneTime: '2025-05-12T09:12:00Z',
  offline: true,
  locationChecked: true,
  distanceMetres: 12,
  accuracyMetres: 8,
  mock: false,
  signature: 'sig-1',
};

/**
 * A phone as it stands before log out: signed in, with a last state, a theme choice, a pairing with
 * its installation id, keys, one waiting offline punch, cached history and one unread notification.
 */
async function phone() {
  const { storage, map } = memoryStorage();
  const db = new MemoryDatabase();
  const queue = new PunchQueue(db);
  const historyCache = new HistoryCache(db, { now: () => 1_700_000_000_000 });
  const notificationsCache = new NotificationsCache(db);
  const keys = { deleted: 0 };
  const pairingStore = new PairingStore({
    storage,
    deleteKeys: async () => {
      keys.deleted += 1;
    },
    deleteQueue: () => queue.clear(),
  });
  const authStore = new AuthStore({
    storage,
    clearCaches: async () => {
      await historyCache.clear();
      await notificationsCache.clear();
    },
  });

  await authStore.saveAccount(ACCOUNT);
  await authStore.saveLastState(ACTIVE);
  await authStore.setDismissedOutcomeId('r9');
  await authStore.setPairingOwnerUserId(ACCOUNT.userId);
  await authStore.setThemeOverride('dark');
  await pairingStore.save(PAIRING);
  await pairingStore.installationId();
  await queue.enqueue(PUNCH, 'IN');
  await historyCache.replaceAll(
    [
      {
        punchId: PUNCH.punchId,
        atMs: Date.parse(PUNCH.phoneTime),
        localDate: '2025-05-12',
        localTime: '14:42',
        direction: 'IN',
        flags: [],
        counted: true,
      },
    ],
    '2025-04-12',
  );
  await notificationsCache.replaceAll([
    {
      id: 'n1',
      text: 'Sri Ganesh Stores accepted you',
      type: 'JOIN_REQUEST_APPROVED',
      createdAt: '2025-05-12T08:00:00Z',
      read: false,
    },
  ]);

  const account = { logout: vi.fn(async () => ({ success: true })) };
  const shell = { refresh: vi.fn(async () => undefined) };
  return {
    map,
    queue,
    historyCache,
    notificationsCache,
    keys,
    pairingStore,
    authStore,
    account,
    shell,
  };
}

describe('logout (R9.5, R11.8, R12.10; design "Sequence: log out")', () => {
  it('deletes the account set and the two caches, keeps the device set and the theme, then re-reads', async () => {
    const p = await phone();
    const pairingBefore = p.map.get(PAIRING_KEY);
    const installationBefore = p.map.get(INSTALLATION_ID_KEY);

    await logout({ account: p.account, authStore: p.authStore }, p.shell);

    // Account set: gone.
    for (const key of ACCOUNT_KEYS) {
      expect(p.map.has(key)).toBe(false);
    }
    expect(await p.authStore.accessToken()).toBeNull();
    expect(await p.authStore.profile()).toBeNull();
    expect(await p.authStore.lastState()).toBeNull();
    expect(await p.authStore.dismissedOutcomeId()).toBeNull();
    expect(await p.historyCache.list()).toEqual([]);
    expect(await p.historyCache.fetchedAt()).toBeNull();
    expect(await p.notificationsCache.list()).toEqual([]);

    // Device set: byte-identical.
    expect(p.map.get(PAIRING_KEY)).toBe(pairingBefore);
    expect(p.map.get(INSTALLATION_ID_KEY)).toBe(installationBefore);
    expect(await p.pairingStore.load()).toEqual(PAIRING);
    expect(p.keys.deleted).toBe(0);
    expect(await p.queue.waitingCount()).toBe(1);
    expect((await p.queue.waiting())[0]?.request).toEqual(PUNCH);

    // The pairing's owner survives with the pairing (R9.5) and the theme choice too (R12.10).
    expect(p.map.get(PAIRING_OWNER_KEY)).toBe(ACCOUNT.userId);
    expect(await p.authStore.pairingOwnerUserId()).toBe(ACCOUNT.userId);
    expect(p.map.get(THEME_OVERRIDE_KEY)).toBe('dark');
    expect(await p.authStore.themeOverride()).toBe('dark');

    // Server first, then the shell.
    expect(p.account.logout).toHaveBeenCalledTimes(1);
    expect(p.shell.refresh).toHaveBeenCalledTimes(1);
  });

  it('logs out just the same when the server is not reachable, and reports it', async () => {
    const p = await phone();
    p.account.logout.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    const onError = vi.fn();

    await logout({ account: p.account, authStore: p.authStore, onError }, p.shell);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('logout call');
    expect(await p.authStore.accessToken()).toBeNull();
    expect(await p.pairingStore.load()).toEqual(PAIRING);
    expect(await p.queue.waitingCount()).toBe(1);
    expect(p.shell.refresh).toHaveBeenCalledTimes(1);
  });

  it('is safe to run twice', async () => {
    const p = await phone();
    await logout({ account: p.account, authStore: p.authStore }, p.shell);
    await expect(
      logout({ account: p.account, authStore: p.authStore }, p.shell),
    ).resolves.toBeUndefined();
    expect(await p.pairingStore.load()).toEqual(PAIRING);
    expect(p.shell.refresh).toHaveBeenCalledTimes(2);
  });
});
