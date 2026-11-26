import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { AppPunchRequest, AppPunchResponse } from '@stockkart/attendance-protocol';

import {
  AppClient,
  HEADER_NONCE,
  HEADER_PAIRING_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  type FetchLike,
} from '../api/appClient';
import { AuthStore } from '../state/authStore';
import { PairingStore, type PairingRecord, type SecureStorage } from '../state/pairingStore';
import { MemoryDatabase } from './memoryDb';
import { PunchQueue } from './PunchQueue';
import { SyncWorker } from './SyncWorker';

// The stores share the `expo-secure-store` adapter at module load; the tests inject memory storage.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

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

const PAIRING: PairingRecord = {
  pairingId: '66f1a2b3c4d5e6f708192a3c',
  shopId: '5f1a2b3c4d5e6f7081920001',
  employeeId: '5f1a2b3c4d5e6f7081920002',
  employeeName: 'Priya Sharma',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: false },
  consentVersion: 1,
};

function punch(n: number): AppPunchRequest {
  return {
    pairingId: PAIRING.pairingId,
    shopId: PAIRING.shopId,
    employeeId: PAIRING.employeeId,
    punchId: `0f6b2c1e-9c4a-4a5e-8f1d-${String(n).padStart(12, '0')}`,
    phoneTime: `2025-05-12T09:${String(n).padStart(2, '0')}:00Z`,
    offline: true,
    locationChecked: false,
    distanceMetres: null,
    accuracyMetres: null,
    mock: false,
    signature: `sig-${n}`,
  };
}

const STORED: AppPunchResponse = {
  outcome: 'STORED',
  direction: 'IN',
  at: '2025-05-12T09:01:00Z',
  atLocal: '14:31',
  flags: ['RECORDED_OFFLINE'],
  duplicate: false,
  todayIn: '14:31',
  todayOut: null,
  nextDirection: 'OUT',
};

/** Records every request's headers and answers each punch as stored. */
function recordingFetch() {
  const headers: Record<string, string>[] = [];
  const fetch: FetchLike = (_url, init) => {
    headers.push({ ...(init.headers as Record<string, string>) });
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, data: STORED }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return { fetch, headers };
}

/**
 * R9.4: the offline queue drains on the device envelope alone. The worker is built exactly as
 * `deps.ts` builds it, over the real `AppClient`, on a phone whose `AuthStore` holds no token (the
 * session ended, or the worker logged out): every queued punch is sent, each request carries the
 * four envelope headers, and none carries `Authorization`.
 */
describe('SyncWorker without a session (R9.4, D8)', () => {
  it('drains the queue over the envelope while the auth store is empty', async () => {
    const storage = memoryStorage();
    const authStore = new AuthStore({ storage });
    const pairingStore = new PairingStore({ storage, randomUUID: () => 'uuid' });
    await pairingStore.save(PAIRING);
    expect(await authStore.accessToken()).toBeNull();
    expect(await authStore.profile()).toBeNull();

    const db = new MemoryDatabase();
    const queue = new PunchQueue(db);
    await queue.enqueue(punch(1), 'IN');
    await queue.enqueue(punch(2), 'OUT');

    const { fetch, headers } = recordingFetch();
    const client = new AppClient({
      baseUrl: 'https://api.example.in/api/v1',
      signer: { signRequest: async () => new Uint8Array([1, 2, 3]) },
      pairingId: async () => (await pairingStore.load())?.pairingId ?? null,
      fetch,
      sha256: async (bytes) => new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)),
      randomUUID: () => '0f8fad5b-d9cb-469f-a165-70867728950e',
    });
    const errors: unknown[] = [];
    const worker = new SyncWorker({
      queue,
      client,
      pairingStore,
      onError: (error) => errors.push(error),
    });

    await worker.start();
    await vi.waitFor(async () => expect(await queue.waitingCount()).toBe(0));
    worker.stop();

    expect(errors).toEqual([]);
    expect(headers).toHaveLength(2);
    for (const sent of headers) {
      expect(sent[HEADER_PAIRING_ID]).toBe(PAIRING.pairingId);
      expect(sent[HEADER_TIMESTAMP]).toBeTruthy();
      expect(sent[HEADER_NONCE]).toBeTruthy();
      expect(sent[HEADER_SIGNATURE]).toBeTruthy();
      expect(Object.keys(sent).map((k) => k.toLowerCase())).not.toContain('authorization');
    }
    // The session is still absent: the worker never touched the account layer.
    expect(await authStore.accessToken()).toBeNull();
    expect(await pairingStore.load()).toEqual(PAIRING);
  });
});
