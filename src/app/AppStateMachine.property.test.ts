// Task 13.5, updated by task 22.2 — Property 14 (App route resolution; R1.6, R1.11, R5.5, R6.1,
// R9.3): for any stored record (`token?`, `accountPhone?`, `lastState?`, `pairing?`) and server
// answer (`state`, `not_authenticated`, `not_reachable`), `AppStateMachine.resolve` answers
// `SignedOut` when there is no token, whatever the stored pairing; `SignedOut` with
// `sessionEnded = true` and the stored pairing, queue and `lastState` untouched on
// `not_authenticated`; otherwise `NeedsPhone` when the phone that applies (`state.account.phone`
// on a `state` answer, `stored.accountPhone` otherwise) is empty, with the `state` answer still
// stored; otherwise `Home(offline)` on `not_reachable` iff `lastState.state == ACTIVE`, else
// `Offline`; and on a `state` answer the route named by `state.state` (`NO_SHOP → Join`,
// `PENDING → Waiting`, `ACTIVE → Home`, `STAFF_NO_EMPLOYEE → Blocked`), with `lastState` replaced
// by the answer and `accountPhone` by `state.account.phone`.
//
// Task 22.2 — Property 32 (An account that reaches Home always has a phone; R1.4, R1.10, R1.11,
// R1.12, R6.1), the route half: for any stored record and any sequence of server answers (`state`
// with any `state.state` and any `account.phone` including `null` and blank, `not_authenticated`,
// `not_reachable`), every route in {`Join`, `Waiting`, `Home`, `Blocked`} has a non-empty
// normalised phone for the account it was resolved from, and every resolution with an empty phone
// and a token is `NeedsPhone`; a `state` answer with an empty phone is still stored. The phone-step
// half is `account/PhoneAndPhotoScreen.property.test.tsx`; the server half is jqwik.
//
// The route a state names, the shape of the stored state and "the phone that applies" are written
// out here independently of `routeFor`, `toStoredState` and `phoneOf`, so the implementation cannot
// vouch for itself. Generators build whole `WorkerStateResponse` answers (every optional section
// absent, `null` or present, whatever the state says; `account.phone` valid, absent, `null`, blank
// or malformed) so the mapping is checked on inputs the server would never send too.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { normalisePhone } from '@stockkart/attendance-protocol';
import type {
  HrNotificationResponse,
  JoinRequestOutcome,
  JoinRequestSelfResponse,
  WorkerAccount,
  WorkerEmployee,
  WorkerPairing,
  WorkerShop,
  WorkerState,
  WorkerStateResponse,
  WorkerToday,
} from '@stockkart/attendance-protocol';

import type { StoredWorkerState } from '../state/authStore';
import {
  resolve,
  stateOf,
  type AppRouteName,
  type ServerAnswer,
  type StoredPairing,
  type StoredRecord,
} from './AppStateMachine';

// `authStore.ts` (for `toStoredState`) binds `expo-secure-store` and `expo-crypto` at module load;
// neither is touched by the pure state machine (vi.mock is hoisted above the imports).
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

const WORKER_STATES: readonly WorkerState[] = ['NO_SHOP', 'PENDING', 'ACTIVE', 'STAFF_NO_EMPLOYEE'];

/** An opaque 24-hex id, as every backend id travels. */
const hexId = fc.hexaString({ minLength: 24, maxLength: 24 });

/** A short name, shop name or reason: printable, non-empty. */
const words = fc.stringMatching(/^[A-Za-z][A-Za-z .'-]{0,29}$/);

// 2025-01-01T00:00:00Z .. 2025-12-31T00:00:00Z, whole seconds
const EPOCH_MIN = Date.UTC(2025, 0, 1);
const EPOCH_MAX = Date.UTC(2025, 11, 31);
const instant = fc
  .integer({ min: EPOCH_MIN / 1000, max: EPOCH_MAX / 1000 })
  .map((s) => new Date(s * 1000).toISOString());
const isoDate = instant.map((iso) => iso.slice(0, 10));
const clockTime = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

/** A section the server may leave out (`undefined`), send as `null`, or fill. */
function section<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | null | undefined> {
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant(undefined) },
    { weight: 1, arbitrary: fc.constant(null) },
    { weight: 3, arbitrary: arb },
  );
}

const workerState: fc.Arbitrary<WorkerState> = fc.constantFrom(...WORKER_STATES);

/** A 10-digit mobile as the server stores it. */
const validPhone = fc.stringMatching(/^[6-9][0-9]{9}$/);

/** A phone field that is empty in one of its ways, or not a phone at all (never sent today; checked anyway). */
const emptyPhone: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constantFrom(' ', '   ', '\t'),
  fc.stringMatching(/^[0-9]{1,9}$/),
  fc.stringMatching(/^[0-9]{11}$/),
  fc.stringMatching(/^[a-z]{1,8}$/),
);

/** The account's phone: valid, or empty / malformed. Drawn independently of `state.state`. */
const phoneField: fc.Arbitrary<string | null | undefined> = fc.oneof(
  { weight: 3, arbitrary: validPhone },
  { weight: 1, arbitrary: validPhone.map((d) => `+91 ${d.slice(0, 5)} ${d.slice(5)}`) },
  { weight: 3, arbitrary: emptyPhone },
);

const account: fc.Arbitrary<WorkerAccount> = fc.record({
  userId: hexId,
  name: words,
  email: words.map((w) => `${w.replace(/[^A-Za-z]/g, '').toLowerCase() || 'w'}@example.in`),
  phone: phoneField,
  photoUrl: section(hexId.map((id) => `/api/v1/users/${id}/photo`)),
  role: fc.constantFrom('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WORKER', 'SUPER_USER'),
});

const request: fc.Arbitrary<JoinRequestSelfResponse> = fc.record({
  id: hexId,
  shopName: words,
  status: fc.constantFrom('PENDING', 'APPROVING', 'APPROVED', 'REJECTED', 'WITHDRAWN'),
  requestedAt: instant,
});

const lastOutcome: fc.Arbitrary<JoinRequestOutcome> = fc.record({
  id: hexId,
  status: fc.constantFrom('REJECTED', 'WITHDRAWN'),
  shopName: words,
  reason: section(words),
  decidedAt: instant,
});

const shop: fc.Arbitrary<WorkerShop> = fc.record({ shopId: hexId, shopName: words });

const employee: fc.Arbitrary<WorkerEmployee> = fc.record({
  employeeId: hexId,
  code: fc.integer({ min: 1, max: 999 }).map((n) => `EMP-${String(n).padStart(3, '0')}`),
  name: words,
  joinDate: isoDate,
  status: fc.constantFrom('ACTIVE', 'EXITED'),
});

const pairing: fc.Arbitrary<WorkerPairing> = fc.oneof(
  fc.constant<WorkerPairing>({ state: 'NOT_PAIRED' }),
  fc.record<WorkerPairing>({ state: fc.constant('PAIRED'), pairingId: hexId }),
);

const today: fc.Arbitrary<WorkerToday> = fc.record({
  date: isoDate,
  in: section(clockTime),
  out: section(clockTime),
  nextDirection: fc.constantFrom('IN', 'OUT'),
});

const notification: fc.Arbitrary<HrNotificationResponse> = fc.record({
  id: hexId,
  type: fc.constantFrom('JOIN_REQUEST_APPROVED', 'JOIN_REQUEST_REJECTED', 'PROFILE_REQUESTED'),
  joinRequestId: section(hexId),
  text: words,
  createdAt: instant,
  read: fc.boolean(),
});

/** Module keys the app knows, plus keys from a newer backend (R6.6); any list, any order. */
const modules = fc.array(
  fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom('ATTENDANCE', 'HISTORY', 'PROFILE') },
    { weight: 1, arbitrary: fc.stringMatching(/^[A-Z]{3,10}$/) },
  ),
  { maxLength: 5 },
);

/**
 * A whole `GET /hr/worker/me` answer. The sections are drawn independently of `state`: the
 * mapping must hold for what the server sends today and for anything shaped like it.
 */
const stateResponse: fc.Arbitrary<WorkerStateResponse> = fc.record({
  state: workerState,
  account,
  request: section(request),
  lastOutcome: section(lastOutcome),
  shop: section(shop),
  employee: section(employee),
  modules,
  pairing: section(pairing),
  today: section(today),
  notifications: fc.record({
    unread: fc.integer({ min: 0, max: 20 }),
    top: fc.array(notification, { maxLength: 3 }),
  }),
  serverTime: instant,
});

/** A state as the phone stored it from an earlier answer. */
const storedWorkerState: fc.Arbitrary<StoredWorkerState> = stateResponse.map(expectedStored);

/** The pairing record as the state machine sees it (its id is enough). */
const storedPairing: fc.Arbitrary<StoredPairing> = fc.record({ pairingId: hexId });

/** A Bearer token as stored: present, or absent as `null` or the empty string. */
const noToken = fc.constantFrom<string | null>(null, '');
const someToken = fc.stringMatching(/^[A-Za-z0-9._-]{8,60}$/);

/** The stored profile's phone: a valid one, or none / blank / malformed (an account made without one). */
const storedPhone: fc.Arbitrary<string | null> = fc.oneof(
  { weight: 3, arbitrary: validPhone },
  { weight: 1, arbitrary: validPhone.map((d) => `+91 ${d.slice(0, 5)} ${d.slice(5)}`) },
  { weight: 2, arbitrary: emptyPhone.map((p) => p ?? null) },
);

function storedRecord(
  token: fc.Arbitrary<string | null>,
  accountPhone: fc.Arbitrary<string | null> = storedPhone,
): fc.Arbitrary<StoredRecord> {
  return fc.record({
    token,
    accountPhone,
    lastState: fc.option(storedWorkerState, { nil: null }),
    pairing: fc.option(storedPairing, { nil: null }),
  });
}

const signedOutRecord = storedRecord(noToken);
const signedInRecord = storedRecord(someToken);
/** Signed in with a phone the rule accepts: the records the pre-22.2 branches were stated for. */
const signedInWithPhone = storedRecord(
  someToken,
  fc.oneof(
    validPhone,
    validPhone.map((d) => `+91 ${d}`),
  ),
);

const serverAnswer: fc.Arbitrary<ServerAnswer> = fc.oneof(
  stateResponse.map((state): ServerAnswer => ({ kind: 'state', state })),
  fc.constant<ServerAnswer>({ kind: 'not_authenticated' }),
  fc.constant<ServerAnswer>({ kind: 'not_reachable' }),
);

// ---------------------------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------------------------

/** The route each server state names, as the design table states it (R6.1). */
const ROUTE_FOR_STATE: Record<WorkerState, AppRouteName> = {
  NO_SHOP: 'Join',
  PENDING: 'Waiting',
  ACTIVE: 'Home',
  STAFF_NO_EMPLOYEE: 'Blocked',
};

/**
 * "The phone that applies" (design "State machine", DD20), written out independently of
 * `resolve`: the answer's `account.phone` on a `state` answer, the stored `accountPhone` otherwise.
 */
function phoneThatApplies(stored: StoredRecord, answer: ServerAnswer): string | null {
  if (answer.kind === 'state') {
    const phone = (answer.state as WorkerStateResponse).account?.phone;
    return typeof phone === 'string' ? phone : null;
  }
  return stored.accountPhone;
}

/** Empty in the sense of R1.11: `normalisePhone` refuses it (`null`, blank, malformed). */
function isEmptyPhone(phone: string | null | undefined): boolean {
  return normalisePhone(phone) == null;
}

/** The routes a signed-in account with a phone reaches; `NeedsPhone` is never one of them. */
const SHOP_ROUTES: readonly AppRouteName[] = ['Join', 'Waiting', 'Home', 'Blocked'];

/**
 * The stored shape of an answer, written out independently of `toStoredState`: the answer minus
 * `account` and `notifications`, with every `null` or absent section dropped (design "Stores").
 */
function expectedStored(answer: WorkerStateResponse): StoredWorkerState {
  const stored: StoredWorkerState = { state: answer.state, modules: [...answer.modules] };
  if (answer.request != null) stored.request = answer.request;
  if (answer.lastOutcome != null) stored.lastOutcome = answer.lastOutcome;
  if (answer.shop != null) stored.shop = answer.shop;
  if (answer.employee != null) stored.employee = answer.employee;
  if (answer.pairing != null) stored.pairing = answer.pairing;
  if (answer.today != null) stored.today = answer.today;
  stored.serverTime = answer.serverTime;
  return stored;
}

// ---------------------------------------------------------------------------------------------
// Property 14
// ---------------------------------------------------------------------------------------------

describe('Feature: worker-app, Property 14: App route resolution', () => {
  it('for any record without a token and any answer, the route is SignedOut whatever the stored pairing or phone, and only the token is normalised (R1.1, R1.6)', () => {
    fc.assert(
      fc.property(signedOutRecord, serverAnswer, (stored, answer) => {
        const before = structuredClone(stored);
        const { route, stored: after } = resolve(stored, answer);

        expect(route).toEqual({ name: 'SignedOut', sessionEnded: false });
        expect(after.token).toBeNull();
        expect(after.accountPhone).toBe(stored.accountPhone);
        expect(after.lastState).toBe(stored.lastState);
        expect(after.pairing).toBe(stored.pairing);
        expect(stored).toEqual(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any signed-in record, not_authenticated clears the token only: SignedOut with sessionEnded, phone, pairing and lastState untouched (R9.3)', () => {
    fc.assert(
      fc.property(signedInRecord, (stored) => {
        const before = structuredClone(stored);
        const { route, stored: after } = resolve(stored, { kind: 'not_authenticated' });

        expect(route).toEqual({ name: 'SignedOut', sessionEnded: true });
        expect(after).toEqual({ ...before, token: null });
        expect(after.lastState).toBe(stored.lastState);
        expect(after.pairing).toBe(stored.pairing);
        expect(stored).toEqual(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any signed-in record and any answer other than a session end, the route is NeedsPhone iff the phone that applies is empty, and a state answer is stored either way (R1.11, DD20)', () => {
    fc.assert(
      fc.property(
        signedInRecord,
        fc.oneof(
          stateResponse.map((state): ServerAnswer => ({ kind: 'state', state })),
          fc.constant<ServerAnswer>({ kind: 'not_reachable' }),
        ),
        (stored, answer) => {
          const before = structuredClone(stored);
          const { route, stored: after } = resolve(stored, answer);
          const phone = phoneThatApplies(stored, answer);

          expect(route.name === 'NeedsPhone').toBe(isEmptyPhone(phone));
          if (answer.kind === 'state') {
            // Stored whatever the route: the next resolve has the truth.
            expect(after.lastState).toEqual(expectedStored(answer.state as WorkerStateResponse));
            expect(after.accountPhone).toBe(phone);
            if (route.name === 'NeedsPhone') {
              expect(route.state).toEqual(after.lastState);
              expect(stateOf(route)).toBe(after.lastState);
            }
          } else {
            expect(after).toEqual(before);
            if (route.name === 'NeedsPhone') {
              expect(route.state).toBeNull();
            }
          }
          expect(after.token).toBe(stored.token);
          expect(after.pairing).toBe(stored.pairing);
          expect(stored).toEqual(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any signed-in record with a phone, not_reachable opens Home offline iff the last state is ACTIVE, else Offline, and stores nothing (R6.1, R6.7)', () => {
    fc.assert(
      fc.property(signedInWithPhone, (stored) => {
        const before = structuredClone(stored);
        const { route, stored: after } = resolve(stored, { kind: 'not_reachable' });

        if (stored.lastState?.state === 'ACTIVE') {
          expect(route).toEqual({ name: 'Home', state: stored.lastState, offline: true });
        } else {
          expect(route).toEqual({ name: 'Offline' });
        }
        expect(route.name === 'Home').toBe(stored.lastState?.state === 'ACTIVE');
        expect(after).toEqual(before);
        expect(after.token).toBe(stored.token);
        expect(after.lastState).toBe(stored.lastState);
        expect(after.pairing).toBe(stored.pairing);
        expect(stored).toEqual(before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any signed-in record (phone or not) and state answer whose account has a phone, the route is the one state.state names and lastState is replaced by the answer minus account and notifications, accountPhone by account.phone (R5.5, R6.1)', () => {
    fc.assert(
      fc.property(
        signedInRecord,
        stateResponse.filter((state) => !isEmptyPhone(state.account.phone)),
        (stored, state) => {
          const before = structuredClone(stored);
          const { route, stored: after } = resolve(stored, { kind: 'state', state });

          // The route named by the state, carrying the stored state.
          expect(route.name).toBe(ROUTE_FOR_STATE[state.state]);
          const expected = expectedStored(state);
          expect(stateOf(route)).toEqual(expected);
          expect(stateOf(route)).toBe(after.lastState);
          if (route.name === 'Home') {
            expect(route.offline).toBe(false);
          }
          if (route.name === 'Blocked') {
            expect(route.kind).toBe('staff_no_employee');
          }
          if (route.name === 'Waiting') {
            // The stored pairing adds nothing to Waiting: the route is the state alone (D11).
            expect(Object.keys(route).sort()).toEqual(['name', 'state']);
          }

          // The last state is replaced; nothing of the account or the banners is stored there.
          expect(after.lastState).toEqual(expected);
          expect(after.lastState).not.toHaveProperty('account');
          expect(after.lastState).not.toHaveProperty('notifications');
          for (const key of Object.keys(after.lastState ?? {})) {
            expect(after.lastState?.[key as keyof StoredWorkerState]).not.toBeNull();
          }
          // The account's phone is kept as the server sent it (the stored profile follows it).
          expect(after.accountPhone).toBe(state.account.phone);

          // Token and pairing are untouched, and the inputs are not mutated.
          expect(after.token).toBe(stored.token);
          expect(after.pairing).toBe(stored.pairing);
          expect(stored).toEqual(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any record and answer, resolve is a function of its inputs: the same inputs give the same resolution', () => {
    fc.assert(
      fc.property(fc.oneof(signedOutRecord, signedInRecord), serverAnswer, (stored, answer) => {
        const first = resolve(stored, answer);
        const second = resolve(structuredClone(stored), structuredClone(answer));
        expect(second).toEqual(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Property 32, route half
// ---------------------------------------------------------------------------------------------

/** A sequence of answers, as launches, foregrounds and screen focuses produce them over a day. */
const answerSequence: fc.Arbitrary<ServerAnswer[]> = fc.array(serverAnswer, {
  minLength: 1,
  maxLength: 8,
});

/**
 * Runs `resolve` over the sequence the way `useAppState` does: each resolution's `stored` is the
 * next one's input (the hook writes it to the store and reads it back), and a `not_authenticated`
 * leaves a token-less record until the sequence "signs in" again with the next token.
 */
function run(
  start: StoredRecord,
  answers: readonly ServerAnswer[],
  tokens: readonly string[],
): { stored: StoredRecord; route: AppRouteName; phone: string | null }[] {
  const trace: { stored: StoredRecord; route: AppRouteName; phone: string | null }[] = [];
  let stored = start;
  let nextToken = 0;
  for (const answer of answers) {
    if (stored.token == null && nextToken < tokens.length) {
      // A sign-in: the token is back, the phone on the profile is what the sign-in answer said
      // (here: left as stored; the next `state` answer refreshes it).
      stored = { ...stored, token: tokens[nextToken] };
      nextToken += 1;
    }
    const resolution = resolve(stored, answer);
    trace.push({
      stored,
      route: resolution.route.name,
      phone: phoneThatApplies(stored, answer),
    });
    stored = resolution.stored;
  }
  return trace;
}

describe('Feature: worker-app, Property 32: An account that reaches Home always has a phone (route half)', () => {
  it('for any stored record and answer sequence, every Join / Waiting / Home / Blocked resolution has a phone normalisePhone accepts, and every resolution with a token and an empty phone (not a session end) is NeedsPhone (R1.4, R1.10, R1.11, R6.1)', () => {
    fc.assert(
      fc.property(
        fc.oneof(signedOutRecord, signedInRecord),
        answerSequence,
        fc.array(someToken, { maxLength: 3 }),
        (start, answers, tokens) => {
          const trace = run(start, answers, tokens);
          expect(trace).toHaveLength(answers.length);
          trace.forEach(({ stored, route, phone }, i) => {
            const answer = answers[i];
            if (SHOP_ROUTES.includes(route)) {
              // The one-line implication of DD20.
              expect(normalisePhone(phone)).not.toBeNull();
              expect(normalisePhone(phone)).toMatch(/^[0-9]{10}$/);
            }
            const signedIn = stored.token != null && stored.token.length > 0;
            if (signedIn && answer.kind !== 'not_authenticated' && isEmptyPhone(phone)) {
              expect(route).toBe('NeedsPhone');
            }
            if (route === 'NeedsPhone') {
              expect(signedIn).toBe(true);
              expect(isEmptyPhone(phone)).toBe(true);
            }
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any signed-in record and state answer with an empty phone, the route is NeedsPhone whatever state.state says, and the answer is still stored (R1.11, R6.7)', () => {
    fc.assert(
      fc.property(
        signedInRecord,
        stateResponse.filter((state) => isEmptyPhone(state.account.phone)),
        (stored, state) => {
          const { route, stored: after } = resolve(stored, { kind: 'state', state });
          expect(route.name).toBe('NeedsPhone');
          expect(SHOP_ROUTES).not.toContain(route.name);
          expect(after.lastState).toEqual(expectedStored(state));
          expect(isEmptyPhone(after.accountPhone)).toBe(true);
          // Saving a phone and reading the same state again then opens the state's screen.
          const saved: StoredRecord = { ...after, accountPhone: '9876543210' };
          const again = resolve(saved, {
            kind: 'state',
            state: { ...state, account: { ...state.account, phone: '9876543210' } },
          });
          expect(again.route.name).toBe(ROUTE_FOR_STATE[state.state]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any signed-in record with an empty stored phone, not_reachable is NeedsPhone, never Home offline, whatever the last state (R1.11, R6.7)', () => {
    fc.assert(
      fc.property(
        storedRecord(
          someToken,
          emptyPhone.map((p) => p ?? null),
        ),
        (stored) => {
          const { route, stored: after } = resolve(stored, { kind: 'not_reachable' });
          expect(route).toEqual({ name: 'NeedsPhone', state: null });
          expect(after).toEqual(stored);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
