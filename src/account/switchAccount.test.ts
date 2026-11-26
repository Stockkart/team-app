import { describe, expect, it, vi } from 'vitest';

import type { AppPunchRequest } from '@stockkart/attendance-protocol';

import { NotReachable, ServerRefusal } from '../api/transport';
import type { ConfirmPrompt } from '../app/useAppState';
import { STRINGS_EN } from '../i18n';
import { MemoryDatabase } from '../queue/memoryDb';
import { PunchQueue } from '../queue/PunchQueue';
import { AuthStore, PAIRING_OWNER_KEY } from '../state/authStore';
import {
  INSTALLATION_ID_KEY,
  PAIRING_KEY,
  PairingStore,
  type PairingRecord,
  type SecureStorage,
} from '../state/pairingStore';
import { needsAccountSwitch, switchAccount, switchAccountPrompt } from './switchAccount';

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

const PAIRING: PairingRecord = {
  pairingId: '66f1a2b3c4d5e6f708192a3c',
  shopId: '5f1a2b3c4d5e6f7081920001',
  employeeId: '5f1a2b3c4d5e6f7081920002',
  employeeName: 'Ravi Kumar',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: true, shopLat: 12.97, shopLng: 77.59, radiusMetres: 150 },
  consentVersion: 2,
};

function punch(n: number): AppPunchRequest {
  return {
    pairingId: PAIRING.pairingId,
    shopId: PAIRING.shopId,
    employeeId: PAIRING.employeeId,
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

/** A paired phone with `waiting` offline punches, keys, an installation id and the pairing's owner stored. */
async function phone(waiting = 2) {
  const { storage, map } = memoryStorage();
  const db = new MemoryDatabase();
  const queue = new PunchQueue(db);
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
  await pairingStore.save(PAIRING);
  await pairingStore.installationId();
  await authStore.setPairingOwnerUserId('u2');
  for (let n = 1; n <= waiting; n++) {
    await queue.enqueue(punch(n), 'IN');
  }
  const client = { unpairMe: vi.fn(async () => ({ unpaired: true })) };
  const onError = vi.fn();
  const prompts: ConfirmPrompt[] = [];
  const confirm = vi.fn(async (prompt: ConfirmPrompt) => {
    prompts.push(prompt);
    return true;
  });
  const shell = { refresh: vi.fn(async () => undefined), confirm };
  return {
    map,
    queue,
    keys,
    pairingStore,
    authStore,
    client,
    onError,
    prompts,
    confirm,
    shell,
    deps: { queue, client, pairingStore, onError },
  };
}

/** Everything the switch must delete, as a snapshot for "untouched" checks. */
async function deviceSet(p: Awaited<ReturnType<typeof phone>>) {
  return {
    pairing: p.map.get(PAIRING_KEY),
    installationId: p.map.get(INSTALLATION_ID_KEY),
    owner: p.map.get(PAIRING_OWNER_KEY),
    waiting: await p.queue.waitingCount(),
    keysDeleted: p.keys.deleted,
  };
}

describe('needsAccountSwitch (R9.6, R9.7)', () => {
  it('is true only when a pairing is stored and its owner is not the account signing in', () => {
    const pairing = { pairingId: PAIRING.pairingId };
    expect(needsAccountSwitch({ pairing, pairingOwnerUserId: 'u1', userId: 'u2' })).toBe(true);
    // The same account comes back: nothing to do, no code needed (R9.6).
    expect(needsAccountSwitch({ pairing, pairingOwnerUserId: 'u1', userId: 'u1' })).toBe(false);
    // A pairing with no recorded owner is treated as another account's: ask.
    expect(needsAccountSwitch({ pairing, pairingOwnerUserId: null, userId: 'u2' })).toBe(true);
    // No pairing: nothing to switch, whatever was recorded.
    expect(needsAccountSwitch({ pairing: null, pairingOwnerUserId: 'u1', userId: 'u2' })).toBe(
      false,
    );
    expect(needsAccountSwitch({ pairing: null, pairingOwnerUserId: null, userId: 'u2' })).toBe(
      false,
    );
  });
});

describe('switchAccountPrompt (R9.7 warning)', () => {
  it('names the waiting punches: none for 0, one line for 1, the count otherwise', () => {
    const none = switchAccountPrompt(0);
    expect(none.question).toBe(STRINGS_EN['switchAccount.question']);
    expect(none.confirmLabel).toBe(STRINGS_EN['switchAccount.confirm']);
    expect(none.cancelLabel).toBe(STRINGS_EN['common.cancel']);
    expect(none.explanation).toBe(STRINGS_EN['switchAccount.explanation']);
    expect(none.explanation).not.toMatch(/will be lost/);

    expect(switchAccountPrompt(1).explanation).toContain(
      '1 punch that was not yet sent will be lost',
    );
    expect(switchAccountPrompt(2).explanation).toContain(
      '2 punches that were not yet sent will be lost',
    );
    expect(switchAccountPrompt(17).explanation).toContain(
      '17 punches that were not yet sent will be lost',
    );
  });
});

describe('switchAccount (R9.7; design Property 23)', () => {
  it('confirm: warns with the queue count, unpairs exactly once, then wipes the device set', async () => {
    const p = await phone(2);
    const result = await switchAccount(p.deps, p.confirm);
    expect(result).toBe('switched');

    expect(p.prompts).toHaveLength(1);
    expect(p.prompts[0].explanation).toContain('2 punches that were not yet sent will be lost');
    expect(p.client.unpairMe).toHaveBeenCalledTimes(1);

    expect(await deviceSet(p)).toEqual({
      pairing: undefined,
      installationId: undefined,
      owner: undefined,
      waiting: 0,
      keysDeleted: 1,
    });
    expect(await p.pairingStore.load()).toBeNull();
    expect(await p.authStore.pairingOwnerUserId()).toBeNull();
    expect(p.onError).not.toHaveBeenCalled();
  });

  it('cancel: nothing is touched, the server is not called', async () => {
    const p = await phone(2);
    const before = await deviceSet(p);
    p.confirm.mockResolvedValueOnce(false);

    expect(await switchAccount(p.deps, p.confirm)).toBe('cancelled');

    expect(p.client.unpairMe).not.toHaveBeenCalled();
    expect(await deviceSet(p)).toEqual(before);
    expect(await p.pairingStore.load()).toEqual(PAIRING);
    expect(await p.authStore.pairingOwnerUserId()).toBe('u2');
  });

  it('the unpair call not reachable: the device set goes anyway, once tried, nothing reported', async () => {
    const p = await phone(1);
    p.client.unpairMe.mockRejectedValueOnce(new NotReachable('CONNECTION'));

    expect(await switchAccount(p.deps, p.confirm)).toBe('switched');

    expect(p.client.unpairMe).toHaveBeenCalledTimes(1);
    expect(await p.pairingStore.load()).toBeNull();
    expect(await p.queue.waitingCount()).toBe(0);
    expect(p.keys.deleted).toBe(1);
    expect(p.onError).not.toHaveBeenCalled();
  });

  it('the server says the pairing is already gone: wiped, nothing reported', async () => {
    const p = await phone(0);
    p.client.unpairMe.mockRejectedValueOnce(
      new ServerRefusal(403, 'This phone is no longer paired. Ask your manager for a new code.'),
    );
    expect(await switchAccount(p.deps, p.confirm)).toBe('switched');
    expect(await p.pairingStore.load()).toBeNull();
    expect(p.onError).not.toHaveBeenCalled();
    // No waiting punches: the warning line is absent.
    expect(p.prompts[0].explanation).not.toMatch(/will be lost/);
  });

  it('any other refusal is reported and the switch still completes', async () => {
    const p = await phone(0);
    const refusal = new ServerRefusal(429, 'Too many attempts, wait a minute');
    p.client.unpairMe.mockRejectedValueOnce(refusal);
    expect(await switchAccount(p.deps, p.confirm)).toBe('switched');
    expect(p.onError).toHaveBeenCalledWith('unpair call', refusal);
    expect(await p.pairingStore.load()).toBeNull();
  });

  it('a failed wipe step is reported; the other steps still ran', async () => {
    const p = await phone(1);
    const failing = new PairingStore({
      storage: {
        async getItem() {
          return null;
        },
        async setItem() {
          /* not used */
        },
        async deleteItem() {
          throw new Error('keystore');
        },
      },
      deleteKeys: async () => {
        p.keys.deleted += 1;
      },
      deleteQueue: () => p.queue.clear(),
    });
    expect(await switchAccount({ ...p.deps, pairingStore: failing }, p.confirm)).toBe('switched');
    expect(p.onError).toHaveBeenCalledWith('wipe pairing', expect.any(Error));
    expect(p.keys.deleted).toBe(1);
    expect(await p.queue.waitingCount()).toBe(0);
  });

  it('a failed queue count is reported and the warning says nothing about punches', async () => {
    const p = await phone(3);
    const broken = {
      waitingCount: vi.fn(async (): Promise<number> => {
        throw new Error('sqlite');
      }),
    };
    expect(await switchAccount({ ...p.deps, queue: broken }, p.confirm)).toBe('switched');
    expect(p.onError).toHaveBeenCalledWith('waiting count', expect.any(Error));
    expect(p.prompts[0].explanation).not.toMatch(/will be lost/);
  });
});
