import { describe, expect, it, vi } from 'vitest';

import type { PairingBootstrap } from '@stockkart/attendance-protocol';

import { AuthStore, PAIRING_OWNER_KEY, type StoredAccount } from '../state/authStore';
import {
  PAIRING_KEY,
  PairingStore,
  type PairingRecord,
  type SecureStorage,
} from '../state/pairingStore';
import { ownedPairingStore } from './ownedPairingStore';

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
  userId: 'u1',
  name: 'Priya Sharma',
  email: 'priya@example.in',
  role: 'WORKER',
  accessToken: 'tok',
};

const BOOTSTRAP: PairingBootstrap = {
  pairingId: '66f1a2b3c4d5e6f708192a3c',
  shopId: '5f1a2b3c4d5e6f7081920001',
  employeeId: '5f1a2b3c4d5e6f7081920002',
  employeeName: 'Priya Sharma',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: false },
  consentVersion: 2,
};

function phone() {
  const { storage, map } = memoryStorage();
  const authStore = new AuthStore({ storage });
  const pairingStore = new PairingStore({
    storage,
    randomUUID: () => '0f8fad5b-d9cb-469f-a165-70867728950e',
    forgetOwner: () => authStore.clearPairingOwner(),
  });
  const onError = vi.fn();
  return {
    map,
    authStore,
    pairingStore,
    onError,
    owned: ownedPairingStore(pairingStore, authStore, onError),
  };
}

describe('ownedPairingStore (R9.5–R9.7)', () => {
  it('save() stores the pairing record and then the signed-in account as its owner', async () => {
    const p = phone();
    await p.authStore.saveAccount(ACCOUNT);

    await p.owned.save(BOOTSTRAP);

    const record: PairingRecord | null = await p.pairingStore.load();
    expect(record).toMatchObject({ pairingId: BOOTSTRAP.pairingId });
    expect(await p.authStore.pairingOwnerUserId()).toBe('u1');
    expect(p.map.get(PAIRING_OWNER_KEY)).toBe('u1');
    expect(p.onError).not.toHaveBeenCalled();
  });

  it('installationId() passes through to the wrapped store', async () => {
    const p = phone();
    expect(await p.owned.installationId()).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(await p.pairingStore.installationId()).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
  });

  it('without a signed-in account the record is still stored, no owner is written and the miss is reported', async () => {
    const p = phone();

    await p.owned.save(BOOTSTRAP);

    expect(p.map.has(PAIRING_KEY)).toBe(true);
    expect(await p.authStore.pairingOwnerUserId()).toBeNull();
    expect(p.onError).toHaveBeenCalledWith('record pairing owner', expect.any(Error));
  });

  it('the owner goes with the pairing: wipe() clears it, log out keeps it', async () => {
    const p = phone();
    await p.authStore.saveAccount(ACCOUNT);
    await p.owned.save(BOOTSTRAP);

    await p.authStore.clearForLogout();
    expect(await p.authStore.pairingOwnerUserId()).toBe('u1');
    expect(await p.pairingStore.load()).not.toBeNull();

    await p.pairingStore.wipe();
    expect(await p.authStore.pairingOwnerUserId()).toBeNull();
    expect(await p.pairingStore.load()).toBeNull();
  });

  it('a new pairing by another account replaces the owner', async () => {
    const p = phone();
    await p.authStore.saveAccount(ACCOUNT);
    await p.owned.save(BOOTSTRAP);
    await p.pairingStore.wipe();
    await p.authStore.saveAccount({ ...ACCOUNT, userId: 'u2', accessToken: 'tok-2' });

    await p.owned.save({ ...BOOTSTRAP, pairingId: '66f1a2b3c4d5e6f708192a3d' });

    expect(await p.authStore.pairingOwnerUserId()).toBe('u2');
  });
});
