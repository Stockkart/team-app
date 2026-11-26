/**
 * Where Stockkart Team opens (worker-app design "State machine"; R1.1, R1.6, R1.11, R5.5, R6.1,
 * R6.7, R9.3; DD20). One pure function, {@link resolve}, turns what the phone has stored and what
 * the server answered into the screen group to show and the record to store next:
 *
 * | Stored                     | Answer              | Route                                        |
 * | -------------------------- | ------------------- | -------------------------------------------- |
 * | no token                   | any                 | `SignedOut`, whatever the stored pairing (R1.1, D11) |
 * | token                      | `not_authenticated` | `SignedOut`, `sessionEnded`; token cleared, everything else kept (R9.3) |
 * | token, account phone empty | `not_reachable` or `state` (any `state.state`) | `NeedsPhone`: the phone step in `update` mode (R1.11, DD20) |
 * | token, last state ACTIVE   | `not_reachable`     | `Home` offline, from the last state (R6.7)   |
 * | token, anything else       | `not_reachable`     | `Offline` with Retry                         |
 * | token                      | `state` NO_SHOP     | `Join`                                       |
 * | token                      | `state` PENDING     | `Waiting`                                    |
 * | token                      | `state` ACTIVE      | `Home`                                       |
 * | token                      | `state` STAFF_NO_EMPLOYEE | `Blocked` (R5.6)                       |
 *
 * **The phone check comes first** (after "is there a token" and "did the session end"), before the
 * `not_reachable` / `state` switch (DD20). The phone that applies is `state.account.phone` on a
 * `state` answer, else the stored `accountPhone`; empty (`null`, `undefined`, blank, or anything
 * `normalisePhone` refuses) means `NeedsPhone`, whatever the shop state. It is a property of the
 * account, not of the shop state, so it holds for `NO_SHOP`, `PENDING`, `ACTIVE` and
 * `STAFF_NO_EMPLOYEE` alike (R1.11 names all four screens), and an account without a phone cannot
 * fix that offline, so `not_reachable` must not open Home from a stale `lastState` for it (R6.7).
 * Property 32: every route in {`Join`, `Waiting`, `Home`, `Blocked`} has a phone.
 *
 * On a `state` answer the stored `lastState` is replaced by the answer (minus `account` and
 * `notifications`, `AuthStore.toStoredState`) and `accountPhone` by the answer's `account.phone`,
 * also when the route is `NeedsPhone`, so the next launch without network has the truth.
 *
 * A stored pairing changes nothing here: there is no sign-in-less path (R1.1, D11). Whether the
 * account signing in is the one the pairing belongs to is decided before the first resolve, by
 * `completeSignIn` comparing `authStore.pairingOwnerUserId` with the new account (R9.6, R9.7), so
 * the account switch runs before the phone check. The hook (`useAppState`) does the calls and the
 * storing; nothing here touches storage or the network.
 *
 * Pure: no Expo, React or React Native import.
 */
import { normalisePhone, type WorkerStateResponse } from '@stockkart/attendance-protocol';

import { toStoredState, type StoredWorkerState, type WorkerStateLike } from '../state/authStore';
import type { PairingRecord } from '../state/pairingStore';

// --- inputs ---

/** The pairing as the state machine needs it: its id is enough. A `PairingRecord` fits. */
export type StoredPairing = Pick<PairingRecord, 'pairingId'>;

/** What the phone has stored, read in one go before each resolution. */
export interface StoredRecord {
  /** The Bearer token, or null when signed out or after the session ended. */
  token: string | null;
  /**
   * The stored account profile's `phone` (`authStore`, written from the login or sign-up answer
   * and refreshed from every `/me` answer's `account.phone`), or null when none is stored (R1.11).
   */
  accountPhone: string | null;
  /** The last `GET /hr/worker/me` answer stored, or null. */
  lastState: StoredWorkerState | null;
  /** The HR-module pairing record, or null when this phone is not paired. Kept, never routed on. */
  pairing: StoredPairing | null;
}

/** The server's answer to `GET /hr/worker/me`, or why there is none. */
export type ServerAnswer =
  | { kind: 'state'; state: WorkerStateResponse | WorkerStateLike }
  /** 401 with the envelope: the session is over (R9.3). */
  | { kind: 'not_authenticated' }
  /** No answer: timeout, connection, 5xx or a bad envelope (R6.1). */
  | { kind: 'not_reachable' };

// --- outputs ---

/** Why the Blocked screen is shown (R5.6). */
export type BlockedKind = 'staff_no_employee';

/** The screen group the navigator mounts. */
export type AppRoute =
  | {
      name: 'SignedOut';
      /** The token was cleared because the server said "not authenticated" (R9.3 line). */
      sessionEnded: boolean;
    }
  /**
   * Signed in, but the account has no phone stored (R1.11, DD20): the phone step in `update`
   * mode, before any other screen. `state` is the answer's state when the server answered, so the
   * next resolve after Save has it; null when the server was not reachable and nothing is stored.
   */
  | { name: 'NeedsPhone'; state: StoredWorkerState | null }
  | { name: 'Join'; state: StoredWorkerState }
  | { name: 'Waiting'; state: StoredWorkerState }
  | {
      name: 'Home';
      state: StoredWorkerState;
      /** The server was not reachable; the screen works from `state` (the last one stored, R6.7). */
      offline: boolean;
    }
  | { name: 'Blocked'; kind: BlockedKind; state: StoredWorkerState | null }
  /** Not reachable and nothing stored to work from: Retry (R6.7). */
  | { name: 'Offline' };

export type AppRouteName = AppRoute['name'];

/** What {@link resolve} decided and what to store next. */
export interface Resolution {
  route: AppRoute;
  /** The stored record after this answer: the token cleared or the last state replaced. */
  stored: StoredRecord;
}

// --- the rule ---

export function resolve(stored: StoredRecord, answer: ServerAnswer): Resolution {
  if (stored.token == null || stored.token.length === 0) {
    return {
      route: { name: 'SignedOut', sessionEnded: false },
      stored: { ...stored, token: null },
    };
  }

  if (answer.kind === 'not_authenticated') {
    // Only the token goes; pairing, queue and last state stay for the next sign-in (R9.3).
    return {
      route: { name: 'SignedOut', sessionEnded: true },
      stored: { ...stored, token: null },
    };
  }

  // The phone check, before the server-state switch (R1.11, DD20). On a `state` answer the answer
  // is stored either way, so the next resolve has the truth.
  const state = answer.kind === 'state' ? toStoredState(answer.state) : null;
  const next: StoredRecord =
    answer.kind === 'state'
      ? { ...stored, lastState: state, accountPhone: phoneOf(answer.state.account) }
      : stored;
  if (normalisePhone(next.accountPhone) == null) {
    return { route: { name: 'NeedsPhone', state }, stored: next };
  }

  if (state == null) {
    // `not_reachable`: Home from the last state when it was ACTIVE, else Retry (R6.7).
    if (stored.lastState?.state === 'ACTIVE') {
      return { route: { name: 'Home', state: stored.lastState, offline: true }, stored };
    }
    return { route: { name: 'Offline' }, stored };
  }
  return { route: routeFor(state), stored: next };
}

/** The route a server state names (R6.1 order is the server's; this is the mapping). */
export function routeFor(state: StoredWorkerState): AppRoute {
  switch (state.state) {
    case 'NO_SHOP':
      return { name: 'Join', state };
    case 'PENDING':
      return { name: 'Waiting', state };
    case 'ACTIVE':
      return { name: 'Home', state, offline: false };
    case 'STAFF_NO_EMPLOYEE':
      return { name: 'Blocked', kind: 'staff_no_employee', state };
  }
}

/** The worker state a route carries, when it carries one. */
export function stateOf(route: AppRoute): StoredWorkerState | null {
  switch (route.name) {
    case 'Join':
    case 'Waiting':
    case 'Home':
      return route.state;
    case 'Blocked':
    case 'NeedsPhone':
      return route.state;
    case 'SignedOut':
    case 'Offline':
      return null;
  }
}

/**
 * The `phone` of a `GET /hr/worker/me` answer's `account`, as the server sent it (not normalised),
 * or null when the section or the field is absent, `null` or not text. `WorkerStateLike` types
 * `account` as `unknown`, so this reads it defensively.
 */
export function phoneOf(account: unknown): string | null {
  if (typeof account !== 'object' || account === null) {
    return null;
  }
  const phone = (account as { phone?: unknown }).phone;
  return typeof phone === 'string' ? phone : null;
}
