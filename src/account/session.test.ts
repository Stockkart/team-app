import { describe, expect, it, vi } from 'vitest';

import type { AppPunchRequest } from '@stockkart/attendance-protocol';

import { inferAccountErrorCode } from '../api/accountClient';
import { NotReachable, ServerRefusal } from '../api/transport';
import type { ConfirmPrompt } from '../app/useAppState';
import { STRINGS_EN } from '../i18n';
import { MemoryDatabase } from '../queue/memoryDb';
import { PunchQueue } from '../queue/PunchQueue';
import { base64Encode } from '../signer/base64';
import {
  AuthStore,
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
import type { PreparedPhoto } from './photo';
import { logout } from './logout';
import { accountErrorText, completeSignIn, emailFromIdToken, nameFromIdToken } from './session';

// The stores share the `expo-secure-store` adapter at module load; the tests inject memory storage.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

const ACCOUNT: StoredAccount = {
  userId: 'u1',
  name: 'Priya Sharma',
  email: 'priya@example.in',
  phone: '9876543210',
  role: 'WORKER',
  accessToken: 'tok',
};

const RAVI: StoredAccount = {
  userId: 'u2',
  name: 'Ravi Kumar',
  email: 'ravi@example.in',
  phone: '9123456780',
  role: 'WORKER',
  accessToken: 'tok-2',
};

const PHOTO: PreparedPhoto = {
  uri: 'file:///cache/encoded.jpg',
  contentType: 'image/jpeg',
  width: 512,
  height: 512,
  bytes: 200 * 1024,
  quality: 0.85,
};

/** A fresh phone: no account stored, not paired. Spies record the order of the steps. */
function deps() {
  const calls: string[] = [];
  return {
    calls,
    authStore: {
      profile: vi.fn(async () => null),
      pairingOwnerUserId: vi.fn(async () => null),
      clearForLogout: vi.fn(async () => undefined),
      saveAccount: vi.fn(async () => {
        calls.push('save');
      }),
      updateProfile: vi.fn(async () => {
        calls.push('profile');
        return { ...ACCOUNT, photoUrl: '/api/v1/users/u1/photo' };
      }),
    },
    account: {
      uploadPhoto: vi.fn(async () => {
        calls.push('upload');
        return {
          photoUrl: '/api/v1/users/u1/photo',
          contentType: 'image/jpeg',
          bytes: 200 * 1024,
          updatedAt: '2025-05-12T09:00:00Z',
        };
      }),
    },
    pairingStore: { load: vi.fn(async () => null), wipe: vi.fn(async () => undefined) },
    queue: { waitingCount: vi.fn(async () => 0) },
    client: { unpairMe: vi.fn(async () => ({ unpaired: true })) },
    onError: vi.fn(),
  };
}

function shellSpy(calls: string[] = []) {
  return {
    refresh: vi.fn(async () => {
      calls.push('refresh');
    }),
    confirm: vi.fn(async (prompt: ConfirmPrompt) => {
      calls.push(`confirm:${prompt.question}`);
      return true;
    }),
  };
}

describe('completeSignIn (R1.5, R1.7, R6.1)', () => {
  it('stores the account, then re-resolves; no photo, no upload', async () => {
    const d = deps();
    const shell = shellSpy(d.calls);
    expect(await completeSignIn(d, shell, ACCOUNT)).toBe('signed_in');
    expect(d.authStore.saveAccount).toHaveBeenCalledWith(ACCOUNT);
    expect(d.account.uploadPhoto).not.toHaveBeenCalled();
    expect(d.calls).toEqual(['save', 'refresh']);
    // A fresh phone: no pairing, no previous account, nothing to switch or clear, no question.
    expect(d.pairingStore.load).toHaveBeenCalledTimes(1);
    expect(d.authStore.pairingOwnerUserId).not.toHaveBeenCalled();
    expect(d.authStore.clearForLogout).not.toHaveBeenCalled();
    expect(shell.confirm).not.toHaveBeenCalled();
  });

  it('with a photo: store, upload with the new session, keep the URL, then re-resolve', async () => {
    const d = deps();
    const shell = shellSpy(d.calls);
    await completeSignIn(d, shell, ACCOUNT, PHOTO);
    expect(d.account.uploadPhoto).toHaveBeenCalledWith({
      uri: PHOTO.uri,
      contentType: 'image/jpeg',
    });
    expect(d.authStore.updateProfile).toHaveBeenCalledWith({
      photoUrl: '/api/v1/users/u1/photo',
    });
    expect(d.calls).toEqual(['save', 'upload', 'profile', 'refresh']);
  });

  it('a failed photo upload is reported and does not fail the sign-in', async () => {
    const d = deps();
    d.account.uploadPhoto.mockRejectedValueOnce(new NotReachable('TIMEOUT'));
    const shell = shellSpy();
    await completeSignIn(d, shell, ACCOUNT, PHOTO);
    expect(d.onError).toHaveBeenCalledWith('photo upload', expect.any(NotReachable));
    expect(d.authStore.updateProfile).not.toHaveBeenCalled();
    expect(shell.refresh).toHaveBeenCalledTimes(1);
  });

  it('stores nothing when saveAccount throws (the error surfaces to the screen)', async () => {
    const d = deps();
    d.authStore.saveAccount.mockRejectedValueOnce(new Error('secure store'));
    const shell = shellSpy();
    await expect(completeSignIn(d, shell, ACCOUNT, PHOTO)).rejects.toThrow('secure store');
    expect(d.account.uploadPhoto).not.toHaveBeenCalled();
    expect(shell.refresh).not.toHaveBeenCalled();
  });
});

// --- the same or another account on a paired phone (R9.6, R9.7) ---

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
  employeeName: 'Priya Sharma',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: true, shopLat: 12.97, shopLng: 77.59, radiusMetres: 150 },
  consentVersion: 2,
};

const ACTIVE: StoredWorkerState = {
  state: 'ACTIVE',
  shop: { shopId: PAIRING.shopId, shopName: PAIRING.shopName },
  employee: {
    employeeId: PAIRING.employeeId,
    code: 'EMP-015',
    name: 'Priya Sharma',
    joinDate: '2025-04-03',
    status: 'ACTIVE',
  },
  modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
  pairing: { state: 'PAIRED', pairingId: PAIRING.pairingId },
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
 * Priya's phone after her session ended (R9.3): her profile, last state and theme are stored, the
 * token is gone; the phone is paired to her record (she is the recorded owner, R9.5) with one
 * waiting punch; the notifications cache holds one row.
 */
async function pairedPhone() {
  const { storage, map } = memoryStorage();
  const db = new MemoryDatabase();
  const queue = new PunchQueue(db);
  const notificationsCache = new NotificationsCache(db);
  const keys = { deleted: 0 };
  const authStore = new AuthStore({ storage, clearCaches: () => notificationsCache.clear() });
  const pairingStore = new PairingStore({
    storage,
    deleteKeys: async () => {
      keys.deleted += 1;
    },
    deleteQueue: () => queue.clear(),
    forgetOwner: () => authStore.clearPairingOwner(),
  });
  await authStore.saveAccount(ACCOUNT);
  await authStore.saveLastState(ACTIVE);
  await authStore.setDismissedOutcomeId('r9');
  await authStore.setPairingOwnerUserId(ACCOUNT.userId);
  await authStore.setThemeOverride('dark');
  await authStore.clearSession();
  await pairingStore.save(PAIRING);
  await pairingStore.installationId();
  await queue.enqueue(PUNCH, 'IN');
  await notificationsCache.replaceAll([
    {
      id: 'n1',
      text: 'Sri Ganesh Stores accepted you',
      type: 'JOIN_REQUEST_APPROVED',
      createdAt: '2025-05-12T08:00:00Z',
      read: false,
    },
  ]);
  const client = { unpairMe: vi.fn(async () => ({ unpaired: true })) };
  const account = { uploadPhoto: vi.fn() };
  const onError = vi.fn();
  return {
    map,
    queue,
    keys,
    pairingStore,
    authStore,
    notificationsCache,
    client,
    onError,
    deps: { authStore, pairingStore, queue, client, account, onError },
  };
}

describe('completeSignIn on a paired phone', () => {
  it('the same account signs in again: the device set is untouched, no question, Home needs no code (R9.6)', async () => {
    const p = await pairedPhone();
    const pairingBefore = p.map.get(PAIRING_KEY);
    const installationBefore = p.map.get(INSTALLATION_ID_KEY);
    const shell = shellSpy();

    expect(await completeSignIn(p.deps, shell, { ...ACCOUNT, accessToken: 'tok-new' })).toBe(
      'signed_in',
    );

    expect(shell.confirm).not.toHaveBeenCalled();
    expect(p.client.unpairMe).not.toHaveBeenCalled();
    expect(p.map.get(PAIRING_KEY)).toBe(pairingBefore);
    expect(p.map.get(INSTALLATION_ID_KEY)).toBe(installationBefore);
    expect(p.keys.deleted).toBe(0);
    expect(await p.queue.waitingCount()).toBe(1);
    // Her own set is kept too: the last state says PAIRED, so Home opens with Attendance Enabled.
    expect(await p.authStore.lastState()).toEqual(ACTIVE);
    expect(await p.authStore.pairingOwnerUserId()).toBe(ACCOUNT.userId);
    expect(await p.authStore.dismissedOutcomeId()).toBe('r9');
    expect(await p.notificationsCache.list()).toHaveLength(1);
    expect(await p.authStore.accessToken()).toBe('tok-new');
    expect(shell.refresh).toHaveBeenCalledTimes(1);
  });

  it('a different account, confirmed: warns with the count, unpairs once, wipes, drops the old set, stores, re-resolves (R9.7)', async () => {
    const p = await pairedPhone();
    const calls: string[] = [];
    const shell = shellSpy(calls);
    p.client.unpairMe.mockImplementationOnce(async () => {
      calls.push('unpair');
      return { unpaired: true };
    });

    expect(await completeSignIn(p.deps, shell, RAVI)).toBe('signed_in');

    expect(shell.confirm).toHaveBeenCalledTimes(1);
    expect(shell.confirm.mock.calls[0][0].explanation).toContain(
      '1 punch that was not yet sent will be lost',
    );
    expect(calls).toEqual([`confirm:${STRINGS_EN['switchAccount.question']}`, 'unpair', 'refresh']);
    expect(p.client.unpairMe).toHaveBeenCalledTimes(1);

    // Device set, the pairing's owner included: gone.
    expect(await p.pairingStore.load()).toBeNull();
    expect(p.map.has(INSTALLATION_ID_KEY)).toBe(false);
    expect(await p.authStore.pairingOwnerUserId()).toBeNull();
    expect(p.keys.deleted).toBe(1);
    expect(await p.queue.waitingCount()).toBe(0);

    // The previous account's set: gone; the new account: stored; the theme: kept.
    expect(await p.authStore.account()).toEqual(RAVI);
    expect(await p.authStore.lastState()).toBeNull();
    expect(await p.authStore.dismissedOutcomeId()).toBeNull();
    expect(await p.notificationsCache.list()).toEqual([]);
    expect(p.map.get(THEME_OVERRIDE_KEY)).toBe('dark');
    expect(p.onError).not.toHaveBeenCalled();
  });

  it('a different account, cancelled: nothing stored, nothing touched, no re-resolve', async () => {
    const p = await pairedPhone();
    const before = new Map(p.map);
    const shell = shellSpy();
    shell.confirm.mockResolvedValueOnce(false);

    expect(await completeSignIn(p.deps, shell, RAVI)).toBe('cancelled');

    expect(p.client.unpairMe).not.toHaveBeenCalled();
    expect(p.map).toEqual(before);
    expect(await p.authStore.accessToken()).toBeNull();
    expect(await p.authStore.profile()).toMatchObject({ userId: 'u1' });
    expect(await p.pairingStore.load()).toEqual(PAIRING);
    expect(p.keys.deleted).toBe(0);
    expect(await p.queue.waitingCount()).toBe(1);
    expect(await p.notificationsCache.list()).toHaveLength(1);
    expect(shell.refresh).not.toHaveBeenCalled();
  });

  it('a different account on a phone without a pairing: no question, the old set still goes', async () => {
    const p = await pairedPhone();
    await p.pairingStore.wipe();
    p.keys.deleted = 0;
    const shell = shellSpy();

    expect(await completeSignIn(p.deps, shell, RAVI)).toBe('signed_in');

    expect(shell.confirm).not.toHaveBeenCalled();
    expect(p.client.unpairMe).not.toHaveBeenCalled();
    expect(p.keys.deleted).toBe(0);
    expect(await p.authStore.account()).toEqual(RAVI);
    expect(await p.authStore.lastState()).toBeNull();
    expect(await p.notificationsCache.list()).toEqual([]);
    expect(shell.refresh).toHaveBeenCalledTimes(1);
  });

  it('after a log out the pairing owner still tells the accounts apart: the same account is not asked, a different one is (R9.5–R9.7)', async () => {
    const p = await pairedPhone();
    await logout(
      { account: { logout: vi.fn(async () => ({ success: true })) }, authStore: p.authStore },
      { refresh: vi.fn(async () => undefined) },
    );
    expect(await p.authStore.profile()).toBeNull();
    expect(await p.authStore.pairingOwnerUserId()).toBe(ACCOUNT.userId);

    // Priya again: nothing asked, nothing unpaired, no code needed (R9.6).
    const same = shellSpy();
    expect(await completeSignIn(p.deps, same, { ...ACCOUNT, accessToken: 'tok-2' })).toBe(
      'signed_in',
    );
    expect(same.confirm).not.toHaveBeenCalled();
    expect(p.client.unpairMe).not.toHaveBeenCalled();
    expect(await p.pairingStore.load()).toEqual(PAIRING);
    expect(await p.queue.waitingCount()).toBe(1);

    // She logs out again and Ravi signs in: the owner says the pairing is not his (R9.7).
    await logout(
      { account: { logout: vi.fn(async () => ({ success: true })) }, authStore: p.authStore },
      { refresh: vi.fn(async () => undefined) },
    );
    const other = shellSpy();
    expect(await completeSignIn(p.deps, other, RAVI)).toBe('signed_in');
    expect(other.confirm).toHaveBeenCalledTimes(1);
    expect(p.client.unpairMe).toHaveBeenCalledTimes(1);
    expect(await p.pairingStore.load()).toBeNull();
    expect(await p.authStore.pairingOwnerUserId()).toBeNull();
    expect(await p.queue.waitingCount()).toBe(0);
    expect(await p.authStore.account()).toEqual(RAVI);
  });

  it('a pairing with no recorded owner is treated as another account\u2019s: the question is asked', async () => {
    const p = await pairedPhone();
    await p.authStore.clearPairingOwner();
    const shell = shellSpy();
    shell.confirm.mockResolvedValueOnce(false);

    expect(await completeSignIn(p.deps, shell, { ...ACCOUNT, accessToken: 'tok-new' })).toBe(
      'cancelled',
    );
    expect(shell.confirm).toHaveBeenCalledTimes(1);
    expect(p.client.unpairMe).not.toHaveBeenCalled();
    expect(await p.pairingStore.load()).toEqual(PAIRING);
  });
});

describe('accountErrorText', () => {
  it('not reachable → the given line; a refusal → its text word for word; else the generic line', () => {
    expect(accountErrorText(new NotReachable('CONNECTION'), 'Offline line')).toBe('Offline line');
    expect(
      accountErrorText(
        new ServerRefusal(401, 'Invalid email or password', inferAccountErrorCode),
        'Offline line',
      ),
    ).toBe('Invalid email or password');
    expect(accountErrorText(new Error('boom'), 'Offline line')).toBe(
      STRINGS_EN['common.somethingWentWrong'],
    );
  });
});

describe('nameFromIdToken (R1.4)', () => {
  function jwt(payload: Record<string, unknown>): string {
    const encode = (value: unknown) =>
      base64Encode(new TextEncoder().encode(JSON.stringify(value)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
  }

  it('prefers given_name, then the first word of name', () => {
    expect(nameFromIdToken(jwt({ given_name: 'Ramesh', name: 'Ramesh Kumar' }))).toBe('Ramesh');
    expect(nameFromIdToken(jwt({ name: 'Priya Sharma' }))).toBe('Priya');
    expect(nameFromIdToken(jwt({ name: 'अनिल कुमार' }))).toBe('अनिल');
  });

  it('is null without a name or for text that is not a JWT', () => {
    expect(nameFromIdToken(jwt({ email: 'x@y.in' }))).toBeNull();
    expect(nameFromIdToken(jwt({ name: '   ' }))).toBeNull();
    expect(nameFromIdToken('not-a-token')).toBeNull();
    expect(nameFromIdToken('a.%%%.c')).toBeNull();
  });

  it('emailFromIdToken reads the email claim, trimmed, and is null when absent, blank or not a JWT (R1.10, R1.13)', () => {
    expect(emailFromIdToken(jwt({ given_name: 'Ramesh', email: ' ramesh@example.in ' }))).toBe(
      'ramesh@example.in',
    );
    expect(emailFromIdToken(jwt({ name: 'Priya Sharma' }))).toBeNull();
    expect(emailFromIdToken(jwt({ email: '   ' }))).toBeNull();
    expect(emailFromIdToken(jwt({ email: 42 }))).toBeNull();
    expect(emailFromIdToken('not-a-token')).toBeNull();
    expect(emailFromIdToken('a.%%%.c')).toBeNull();
    // A payload that is JSON but not an object carries no claims.
    const encode = (value: unknown) =>
      base64Encode(new TextEncoder().encode(JSON.stringify(value)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    expect(emailFromIdToken(`${encode({ alg: 'RS256' })}.${encode(['x@y.in'])}.sig`)).toBeNull();
    expect(nameFromIdToken(`${encode({ alg: 'RS256' })}.${encode('Ramesh')}.sig`)).toBeNull();
  });
});

describe('logout (R9.5)', () => {
  it('server first, then the account set, then the shell; never throws', async () => {
    const calls: string[] = [];
    const d = {
      account: {
        logout: vi.fn(async () => {
          calls.push('server');
          return { success: true };
        }),
      },
      authStore: {
        clearForLogout: vi.fn(async () => {
          calls.push('clear');
        }),
      },
      onError: vi.fn(),
    };
    const shell = {
      refresh: vi.fn(async () => {
        calls.push('refresh');
      }),
    };
    await logout(d, shell);
    expect(calls).toEqual(['server', 'clear', 'refresh']);

    d.account.logout.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    d.authStore.clearForLogout.mockRejectedValueOnce(new Error('secure store'));
    await expect(logout(d, shell)).resolves.toBeUndefined();
    expect(d.onError).toHaveBeenCalledTimes(2);
    expect(shell.refresh).toHaveBeenCalledTimes(2);
  });
});
