import { describe, expect, it, vi } from 'vitest';

import type { WorkerStateResponse } from '@stockkart/attendance-protocol';

import type { StoredWorkerState } from '../state/authStore';
import type { PairingRecord } from '../state/pairingStore';
import { phoneOf, resolve, routeFor, stateOf, type StoredRecord } from './AppStateMachine';

// `authStore.ts` (for `toStoredState`) binds `expo-secure-store` and `expo-crypto` at module load;
// neither is touched by the pure state machine (vi.mock is hoisted above the imports).
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

const PAIRING: PairingRecord = {
  pairingId: '66f1a2b3c4d5e6f708192a3b',
  shopId: '5f1a2b3c4d5e6f7081920001',
  employeeId: '5f1a2b3c4d5e6f7081920002',
  employeeName: 'Ravi Kumar',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: false },
  consentVersion: 1,
};

const ACCOUNT: WorkerStateResponse['account'] = {
  userId: 'u1',
  name: 'Priya Sharma',
  email: 'priya@example.in',
  phone: '9876543210',
  role: 'WORKER',
};

function answer(partial: Partial<WorkerStateResponse> & Pick<WorkerStateResponse, 'state'>) {
  const state: WorkerStateResponse = {
    account: ACCOUNT,
    modules: [],
    notifications: { unread: 0, top: [] },
    serverTime: '2025-05-12T09:00:00Z',
    ...partial,
  };
  return { kind: 'state' as const, state };
}

const ACTIVE_STORED: StoredWorkerState = {
  state: 'ACTIVE',
  shop: { shopId: 's1', shopName: 'Sri Ganesh Stores' },
  employee: {
    employeeId: 'e1',
    code: 'EMP-015',
    name: 'Priya Sharma',
    joinDate: '2025-05-12',
    status: 'ACTIVE',
  },
  modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
  pairing: { state: 'NOT_PAIRED' },
};

function stored(partial: Partial<StoredRecord> = {}): StoredRecord {
  return { token: 'tok', accountPhone: '9876543210', lastState: null, pairing: null, ...partial };
}

describe('resolve: no token (R1.1, R1.6)', () => {
  it('is SignedOut whatever the answer and whatever the stored pairing', () => {
    const unpaired = resolve(stored({ token: null }), answer({ state: 'ACTIVE' }));
    expect(unpaired.route).toEqual({ name: 'SignedOut', sessionEnded: false });

    // A stored pairing opens no sign-in-less path (D11): the same screen, the pairing kept.
    const paired = resolve(stored({ token: null, pairing: PAIRING }), { kind: 'not_reachable' });
    expect(paired.route).toEqual({ name: 'SignedOut', sessionEnded: false });
    expect(paired.stored.pairing).toBe(PAIRING);
  });

  it('treats an empty token as no token and keeps the rest of the record', () => {
    const before = stored({ token: '', lastState: ACTIVE_STORED, pairing: PAIRING });
    const { route, stored: after } = resolve(before, { kind: 'not_authenticated' });
    expect(route.name).toBe('SignedOut');
    expect(after).toEqual({ ...before, token: null });
  });
});

describe('resolve: not authenticated (R9.3)', () => {
  it('clears the token only and says the session ended', () => {
    const before = stored({ lastState: ACTIVE_STORED, pairing: PAIRING });
    const { route, stored: after } = resolve(before, { kind: 'not_authenticated' });
    expect(route).toEqual({ name: 'SignedOut', sessionEnded: true });
    expect(after.token).toBeNull();
    expect(after.lastState).toBe(before.lastState);
    expect(after.pairing).toBe(before.pairing);
  });
});

describe('resolve: not reachable (R6.7)', () => {
  it('opens Home offline from the last state when it was ACTIVE', () => {
    const before = stored({ lastState: ACTIVE_STORED });
    const { route, stored: after } = resolve(before, { kind: 'not_reachable' });
    expect(route).toEqual({ name: 'Home', state: ACTIVE_STORED, offline: true });
    expect(after).toEqual(before);
  });

  it.each<StoredWorkerState | null>([
    null,
    { state: 'NO_SHOP', modules: [] },
    { state: 'PENDING', modules: [] },
    { state: 'STAFF_NO_EMPLOYEE', modules: [] },
  ])('shows Offline when the last state is %j', (lastState) => {
    const { route, stored: after } = resolve(stored({ lastState }), { kind: 'not_reachable' });
    expect(route).toEqual({ name: 'Offline' });
    expect(after.lastState).toBe(lastState);
  });

  it('never opens Home offline for an account without a phone: NeedsPhone, not Home, from a stale ACTIVE last state (R1.11, R6.7, DD20)', () => {
    for (const accountPhone of [null, '', '  ']) {
      const before = stored({ accountPhone, lastState: ACTIVE_STORED });
      const { route, stored: after } = resolve(before, { kind: 'not_reachable' });
      expect(route).toEqual({ name: 'NeedsPhone', state: null });
      expect(after).toEqual(before);
    }
    // And not Offline either when there is nothing stored: the phone comes first.
    expect(
      resolve(stored({ accountPhone: null, lastState: null }), { kind: 'not_reachable' }).route,
    ).toEqual({ name: 'NeedsPhone', state: null });
  });
});

describe('resolve: the phone check comes before the shop state (R1.11, DD20)', () => {
  it.each<[string | null | undefined, 'NeedsPhone' | 'Join']>([
    [null, 'NeedsPhone'],
    [undefined, 'NeedsPhone'],
    ['', 'NeedsPhone'],
    ['  ', 'NeedsPhone'],
    ['12345', 'NeedsPhone'],
    ['+91 98765 43210', 'Join'],
    ['9876543210', 'Join'],
  ])('a NO_SHOP answer whose account.phone is %j → %s', (phone, expected) => {
    const { route } = resolve(
      stored({ accountPhone: null }),
      answer({ state: 'NO_SHOP', account: { ...ACCOUNT, phone } }),
    );
    expect(route.name).toBe(expected);
  });

  it.each<WorkerStateResponse['state']>(['NO_SHOP', 'PENDING', 'ACTIVE', 'STAFF_NO_EMPLOYEE'])(
    'a %s answer with no phone → NeedsPhone, with the answer stored as lastState and accountPhone cleared',
    (state) => {
      const before = stored({ accountPhone: '9876543210', lastState: ACTIVE_STORED });
      const { route, stored: after } = resolve(
        before,
        answer({ state, account: { ...ACCOUNT, phone: null } }),
      );
      expect(route).toEqual({ name: 'NeedsPhone', state: after.lastState });
      expect(stateOf(route)).toEqual({
        state,
        modules: [],
        serverTime: '2025-05-12T09:00:00Z',
      });
      expect(after.lastState).toEqual(stateOf(route));
      expect(after.accountPhone).toBeNull();
      expect(after.token).toBe('tok');
      // The answer's state is stored even though the shop screen is not shown.
      expect(after.lastState?.state).toBe(state);
    },
  );

  it('the answer\u2019s phone replaces the stored one in both directions', () => {
    // Stored without a phone, server says it has one (saved from the web): Join, phone stored.
    const gained = resolve(
      stored({ accountPhone: null }),
      answer({ state: 'NO_SHOP', account: { ...ACCOUNT, phone: '9123456780' } }),
    );
    expect(gained.route.name).toBe('Join');
    expect(gained.stored.accountPhone).toBe('9123456780');
    // Stored with a phone, server says none: NeedsPhone, phone cleared.
    const lost = resolve(
      stored({ accountPhone: '9876543210' }),
      answer({ state: 'ACTIVE', account: { ...ACCOUNT, phone: undefined } }),
    );
    expect(lost.route.name).toBe('NeedsPhone');
    expect(lost.stored.accountPhone).toBeNull();
  });

  it('the stored phone is kept as the server sent it, and the check accepts what normalisePhone accepts', () => {
    const { route, stored: after } = resolve(
      stored({ accountPhone: null }),
      answer({ state: 'NO_SHOP', account: { ...ACCOUNT, phone: '+91 98765 43210' } }),
    );
    expect(route.name).toBe('Join');
    expect(after.accountPhone).toBe('+91 98765 43210');
  });

  it('a session end and no token still come first: no NeedsPhone without a token or after a 401', () => {
    expect(
      resolve(stored({ token: null, accountPhone: null }), answer({ state: 'NO_SHOP' })).route,
    ).toEqual({ name: 'SignedOut', sessionEnded: false });
    expect(resolve(stored({ accountPhone: null }), { kind: 'not_authenticated' }).route).toEqual({
      name: 'SignedOut',
      sessionEnded: true,
    });
  });

  it('phoneOf reads account.phone defensively', () => {
    expect(phoneOf({ phone: '9876543210' })).toBe('9876543210');
    expect(phoneOf({ phone: '' })).toBe('');
    expect(phoneOf({ phone: null })).toBeNull();
    expect(phoneOf({ phone: 9876543210 })).toBeNull();
    expect(phoneOf({})).toBeNull();
    expect(phoneOf(null)).toBeNull();
    expect(phoneOf(undefined)).toBeNull();
    expect(phoneOf('9876543210')).toBeNull();
  });

  it('stateOf(NeedsPhone) is its state or null', () => {
    expect(stateOf({ name: 'NeedsPhone', state: null })).toBeNull();
    expect(stateOf({ name: 'NeedsPhone', state: ACTIVE_STORED })).toBe(ACTIVE_STORED);
  });
});

describe('resolve: a state answer (R5.5, R6.1)', () => {
  it('NO_SHOP → Join, and stores the answer as the last state', () => {
    const outcome = {
      id: 'r1',
      status: 'REJECTED' as const,
      shopName: 'Sri Ganesh Stores',
      reason: 'No vacancy',
      decidedAt: '2025-05-11T10:00:00Z',
    };
    const { route, stored: after } = resolve(
      stored(),
      answer({ state: 'NO_SHOP', lastOutcome: outcome, request: null, shop: null }),
    );
    expect(route).toEqual({
      name: 'Join',
      state: {
        state: 'NO_SHOP',
        modules: [],
        lastOutcome: outcome,
        serverTime: '2025-05-12T09:00:00Z',
      },
    });
    expect(after.lastState).toEqual(stateOf(route));
    // Nothing of `account` or `notifications` is stored.
    expect(after.lastState).not.toHaveProperty('account');
    expect(after.lastState).not.toHaveProperty('notifications');
  });

  it('PENDING → Waiting, with or without a stored pairing', () => {
    const request = {
      id: 'r2',
      shopName: 'Sri Ganesh Stores',
      status: 'PENDING' as const,
      requestedAt: '2025-05-12T08:00:00Z',
    };

    expect(resolve(stored(), answer({ state: 'PENDING', request })).route).toEqual({
      name: 'Waiting',
      state: { state: 'PENDING', modules: [], request, serverTime: '2025-05-12T09:00:00Z' },
    });
    expect(
      resolve(stored({ pairing: PAIRING }), answer({ state: 'PENDING', request })).route,
    ).toMatchObject({ name: 'Waiting' });
  });

  it('ACTIVE → Home online, replacing an older last state', () => {
    const older: StoredWorkerState = { state: 'PENDING', modules: [] };
    const { route, stored: after } = resolve(
      stored({ lastState: older }),
      answer({
        state: 'ACTIVE',
        shop: ACTIVE_STORED.shop,
        employee: ACTIVE_STORED.employee,
        modules: ACTIVE_STORED.modules,
        pairing: ACTIVE_STORED.pairing,
      }),
    );
    expect(route).toMatchObject({ name: 'Home', offline: false });
    expect(after.lastState).toMatchObject({ state: 'ACTIVE', modules: ACTIVE_STORED.modules });
    expect(after.token).toBe('tok');
  });

  it('STAFF_NO_EMPLOYEE → Blocked for a staff account (R5.6)', () => {
    const { route } = resolve(
      stored(),
      answer({ state: 'STAFF_NO_EMPLOYEE', account: { ...ACCOUNT, role: 'MANAGER' } }),
    );
    expect(route).toMatchObject({ name: 'Blocked', kind: 'staff_no_employee' });
  });

  it('routeFor maps every server state', () => {
    expect(routeFor({ state: 'NO_SHOP', modules: [] }).name).toBe('Join');
    expect(routeFor({ state: 'PENDING', modules: [] }).name).toBe('Waiting');
    expect(routeFor({ state: 'ACTIVE', modules: [] }).name).toBe('Home');
    expect(routeFor({ state: 'STAFF_NO_EMPLOYEE', modules: [] }).name).toBe('Blocked');
  });
});
