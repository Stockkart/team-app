/**
 * What Stockkart Team keeps about the signed-in account (design "Stores" table; worker-app
 * R9.2, R9.3, R9.5, R11.8, R12.10), in the phone's secure store (`expo-secure-store`), next to but
 * apart from the pairing (`pairingStore.ts`). Exactly these items are written, nothing else:
 *
 * | Key                              | Holds                                                           |
 * | -------------------------------- | --------------------------------------------------------------- |
 * | `skat.account`                   | the profile: `userId`, `name`, `email`, `phone`, `photoUrl?`, `role` |
 * | `skat.account.token`             | the Bearer access token, alone                                  |
 * | `skat.account.lastState`         | the last `WorkerStateResponse` minus `notifications` and `account` |
 * | `skat.account.dismissedOutcome`  | the id of the rejection card the worker dismissed (R4.12)       |
 * | `skat.pairingOwnerUserId`        | the account the stored pairing was made under; survives log out (R9.5, R9.7) |
 * | `skat.themeOverride`             | `system | light | dark`; survives log out (R12.10)               |
 *
 * Why several keys and not one `skat.account` blob: `expo-secure-store` caps a value at 2048 bytes
 * on Android (a larger write is refused or truncated by the platform). A token plus a profile plus
 * a state with a 200-character rejection reason can pass that, so each item is its own key and
 * every write is checked against {@link MAX_SECURE_VALUE_BYTES} before it reaches the store. The
 * split also makes the two clear operations exact: {@link clearSession} deletes the token key and
 * nothing else (R9.3), {@link clearForLogout} deletes every `skat.account*` key, empties the SQLite
 * history and notifications caches through the injected `clearCaches`, and leaves
 * `skat.themeOverride` and `skat.pairingOwnerUserId` alone (R9.5, R12.10). Neither touches the
 * pairing record, the installation id, the hardware keys or the offline queue (D9): those are
 * `PairingStore.wipe()`'s, and `skat.pairingOwnerUserId` goes with them (`PairingStore.wipe()` is
 * given {@link AuthStore.clearPairingOwner} as a step): it is written when the signed-in worker
 * completes a pairing and read at the next sign-in to tell the same account (nothing to do, R9.6)
 * from a different one (`switchAccount`, R9.7). It is used for nothing else (R11.8).
 *
 * `StoredWorkerState` is the protocol's `WorkerStateResponse` minus `account` and `notifications`,
 * with the server's `null`s dropped ({@link toStoredState}). `account` is not stored twice: it is
 * the profile; `notifications` live in the SQLite cache (`NotificationsCache`), not here.
 *
 * Never stored here: a password, a Google ID token, a photo (only its URL), a
 * notification text, or anything about another employee. Nothing account-related is written to
 * AsyncStorage, files or logs (R9.2; lint bans AsyncStorage).
 *
 * Pure apart from the default `SecureStorage`, which is the `expo-secure-store` adapter shared with
 * `pairingStore.ts` and replaced in tests.
 */
import type {
  JoinRequestOutcome,
  JoinRequestSelfResponse,
  WorkerEmployee,
  WorkerPairing,
  WorkerShop,
  WorkerState,
  WorkerStateResponse,
  WorkerToday,
} from '@stockkart/attendance-protocol';

import { isThemeOverride, type ThemeOverride } from '../theme/useTheme';
import { expoSecureStorage, type SecureStorage } from './pairingStore';

// --- stored shapes ---

/** The account as `POST /auth/login|signup` and `GET /hr/worker/me` describe it (no token). */
export interface AccountProfile {
  userId: string;
  name: string;
  email: string;
  /**
   * Absent for an account created without one (a staff login made on the web with Google); required
   * for WORKER sign-up. Written from the login or sign-up answer, refreshed from every `/me`
   * answer's `account.phone` (`useAppState`) and set by the phone step (`updateProfile({phone})`):
   * `AppStateMachine.resolve` reads it as `accountPhone` and routes to `NeedsPhone` while it is
   * empty (R1.11, DD20).
   */
  phone?: string;
  /** Authenticated URL (`GET /api/v1/users/{id}/photo`); loaded with the token in the headers. */
  photoUrl?: string;
  /** `WORKER`, or a staff role (`OWNER`, `ADMIN`, `MANAGER`, `CASHIER`); unknown names are kept. */
  role: string;
}

/** The profile plus the session token: what a sign-in or sign-up answer gives. */
export interface StoredAccount extends AccountProfile {
  accessToken: string;
}

export type WorkerStateName = WorkerState;

/**
 * The protocol's `WorkerStateResponse` minus `account` and `notifications` (see the module note).
 * Optional sections are absent, never `null`, so a stored record reads back equal to what was
 * stored.
 */
export interface StoredWorkerState {
  state: WorkerStateName;
  /** The open request while `PENDING`. */
  request?: JoinRequestSelfResponse;
  /** The last decided request within 90 days; `NO_SHOP` only (the Join screen's card, R4.12). */
  lastOutcome?: JoinRequestOutcome;
  shop?: WorkerShop;
  employee?: WorkerEmployee;
  /** Server module keys in server order; `[]` unless `ACTIVE` (R6.4). */
  modules: string[];
  pairing?: WorkerPairing;
  /** Today's times for the Attendance tile line (R6.5). */
  today?: WorkerToday;
  serverTime?: string;
}

/**
 * What {@link AuthStore.saveLastState} accepts: a `GET /hr/worker/me` answer
 * (`WorkerStateResponse`), or the stored shape itself. The two fields not stored here are
 * optional and ignored; `null` sections are dropped; fields from a newer backend are dropped at
 * runtime too (only the {@link StoredWorkerState} fields are written).
 */
export type WorkerStateLike = {
  [K in keyof Omit<StoredWorkerState, 'state' | 'modules'>]?: StoredWorkerState[K] | null;
} & Pick<StoredWorkerState, 'state' | 'modules'> & {
    account?: unknown;
    notifications?: unknown;
  };

/** A `GET /hr/worker/me` answer is storable as is (compile-time check of the two shapes). */
const _acceptsServerAnswer: (answer: WorkerStateResponse) => WorkerStateLike = (answer) => answer;
void _acceptsServerAnswer;

/** Everything the store holds, read in one go for `AppStateMachine.resolve` (task 13.4). */
export interface AuthSnapshot {
  accessToken: string | null;
  profile: AccountProfile | null;
  lastState: StoredWorkerState | null;
  dismissedOutcomeId: string | null;
  themeOverride: ThemeOverride;
  /** The account the stored pairing was made under, or null when none is recorded (R9.5, R9.7). */
  pairingOwnerUserId: string | null;
}

// --- keys ---

export const ACCOUNT_KEY = 'skat.account';
export const TOKEN_KEY = 'skat.account.token';
export const LAST_STATE_KEY = 'skat.account.lastState';
export const DISMISSED_OUTCOME_KEY = 'skat.account.dismissedOutcome';
export const PAIRING_OWNER_KEY = 'skat.pairingOwnerUserId';
export const THEME_OVERRIDE_KEY = 'skat.themeOverride';

/**
 * The keys {@link AuthStore.clearForLogout} deletes; `THEME_OVERRIDE_KEY` and `PAIRING_OWNER_KEY`
 * are not among them (R9.5, R12.10).
 */
export const ACCOUNT_KEYS: readonly string[] = [
  TOKEN_KEY,
  ACCOUNT_KEY,
  LAST_STATE_KEY,
  DISMISSED_OUTCOME_KEY,
];

/** The keys log out keeps; next to the pairing's own (`PairingStore`). */
export const KEPT_ON_LOGOUT_KEYS: readonly string[] = [THEME_OVERRIDE_KEY, PAIRING_OWNER_KEY];

/** `expo-secure-store`'s per-value limit on Android (bytes of the UTF-8 value). */
export const MAX_SECURE_VALUE_BYTES = 2048;

export interface AuthStoreOptions {
  storage?: SecureStorage;
  /**
   * Empties the SQLite caches that belong to the account (`HistoryCache.clear`,
   * `NotificationsCache.clear`) on log out (R9.5, R11.8). Must tolerate "already empty". The
   * composition root passes it; tests pass a spy.
   */
  clearCaches?: () => Promise<void>;
}

export class AuthStore {
  private readonly storage: SecureStorage;
  private readonly clearCaches: () => Promise<void>;

  constructor(options: AuthStoreOptions = {}) {
    this.storage = options.storage ?? expoSecureStorage;
    this.clearCaches = options.clearCaches ?? noop;
  }

  // --- session and profile ---

  /** The Bearer token, or null when signed out or after the session ended (R9.3). */
  async accessToken(): Promise<string | null> {
    const token = await this.storage.getItem(TOKEN_KEY);
    return token && token.length > 0 ? token : null;
  }

  /** The stored profile, or null when no account is stored (or the record is unreadable). */
  async profile(): Promise<AccountProfile | null> {
    return this.readJson(ACCOUNT_KEY, isProfile);
  }

  /** Token and profile together, or null when either is missing. */
  async account(): Promise<StoredAccount | null> {
    const [accessToken, profile] = await Promise.all([this.accessToken(), this.profile()]);
    return accessToken && profile ? { ...profile, accessToken } : null;
  }

  /**
   * Stores a sign-in or sign-up answer: the profile first, then the token, so a token never exists
   * without a profile. Replaces any earlier account; extra fields from the server are dropped.
   */
  async saveAccount(account: StoredAccount): Promise<void> {
    const profile = toProfile(account);
    if (!isProfile(profile)) {
      throw new Error('account record is incomplete');
    }
    if (typeof account.accessToken !== 'string' || account.accessToken.length === 0) {
      throw new Error('account record has no access token');
    }
    await this.put(ACCOUNT_KEY, JSON.stringify(profile));
    await this.put(TOKEN_KEY, account.accessToken);
  }

  /** Replaces the token only (a fresh sign-in by the same account after the session ended). */
  async saveAccessToken(accessToken: string): Promise<void> {
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('access token is empty');
    }
    await this.put(TOKEN_KEY, accessToken);
  }

  /** Changes name, phone or photo URL after Edit details (R8.2). Throws when no profile exists. */
  async updateProfile(change: Partial<Omit<AccountProfile, 'userId'>>): Promise<AccountProfile> {
    const current = await this.profile();
    if (current == null) {
      throw new Error('not signed in');
    }
    const next = toProfile({ ...current, ...change });
    if (!isProfile(next)) {
      throw new Error('account record is incomplete');
    }
    await this.put(ACCOUNT_KEY, JSON.stringify(next));
    return next;
  }

  // --- last known state (R6.7) ---

  /** The last `WorkerStateResponse` stored, or null. */
  async lastState(): Promise<StoredWorkerState | null> {
    return this.readJson(LAST_STATE_KEY, isStoredState);
  }

  /**
   * Stores a `GET /hr/worker/me` answer for the next launch without network (R6.1, R6.7). Only the
   * {@link StoredWorkerState} fields are written: `notifications` go to the SQLite cache and
   * `account` is the profile.
   */
  async saveLastState(state: WorkerStateLike): Promise<void> {
    const stored = toStoredState(state);
    if (!isStoredState(stored)) {
      throw new Error('worker state is incomplete');
    }
    await this.put(LAST_STATE_KEY, JSON.stringify(stored));
  }

  // --- small flags ---

  /** The `lastOutcome.id` whose card the worker dismissed with "Ask another shop" (R4.12). */
  async dismissedOutcomeId(): Promise<string | null> {
    const id = await this.storage.getItem(DISMISSED_OUTCOME_KEY);
    return id && id.length > 0 ? id : null;
  }

  async setDismissedOutcomeId(id: string | null): Promise<void> {
    if (id == null) {
      await this.storage.deleteItem(DISMISSED_OUTCOME_KEY);
    } else {
      await this.put(DISMISSED_OUTCOME_KEY, id);
    }
  }

  /** The worker's theme choice; `system` when none was made (R12.10). */
  async themeOverride(): Promise<ThemeOverride> {
    const raw = await this.storage.getItem(THEME_OVERRIDE_KEY);
    if (raw == null) {
      return 'system';
    }
    if (!isThemeOverride(raw)) {
      await this.storage.deleteItem(THEME_OVERRIDE_KEY);
      return 'system';
    }
    return raw;
  }

  async setThemeOverride(override: ThemeOverride): Promise<void> {
    if (!isThemeOverride(override)) {
      throw new Error(`not a theme override: ${String(override)}`);
    }
    await this.put(THEME_OVERRIDE_KEY, override);
  }

  // --- the pairing's owner (R9.5–R9.7) ---

  /**
   * The id of the account that completed the pairing this phone holds, or null when none is
   * recorded. Survives log out; goes with the pairing ({@link clearPairingOwner} is a
   * `PairingStore.wipe()` step). Read only by `completeSignIn` to tell the same account from a
   * different one (R9.6, R9.7).
   */
  async pairingOwnerUserId(): Promise<string | null> {
    const id = await this.storage.getItem(PAIRING_OWNER_KEY);
    return id && id.length > 0 ? id : null;
  }

  /** Written when the signed-in worker completes a pairing (`PairingFlow.agree` → store). */
  async setPairingOwnerUserId(userId: string): Promise<void> {
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new Error('pairing owner id is empty');
    }
    await this.put(PAIRING_OWNER_KEY, userId);
  }

  /** The pairing is gone (Remove this phone, pairing ended, account switch): so is its owner. */
  async clearPairingOwner(): Promise<void> {
    await this.storage.deleteItem(PAIRING_OWNER_KEY);
  }

  // --- reading everything ---

  /** Every item in one read, for the state machine. */
  async snapshot(): Promise<AuthSnapshot> {
    const [accessToken, profile, lastState, dismissedOutcomeId, themeOverride, pairingOwnerUserId] =
      await Promise.all([
        this.accessToken(),
        this.profile(),
        this.lastState(),
        this.dismissedOutcomeId(),
        this.themeOverride(),
        this.pairingOwnerUserId(),
      ]);
    return {
      accessToken,
      profile,
      lastState,
      dismissedOutcomeId,
      themeOverride,
      pairingOwnerUserId,
    };
  }

  // --- the two clears ---

  /**
   * The session ended ("not authenticated", R9.3): the token goes, everything else stays, so a
   * sign-in by the same account returns to the previous screen with everything intact.
   */
  async clearSession(): Promise<void> {
    await this.storage.deleteItem(TOKEN_KEY);
  }

  /**
   * Log out (R9.5, R11.8): deletes the token, the profile, the last state and the dismissed
   * outcome, then empties the history and notifications caches. Keeps the theme choice (R12.10)
   * and the pairing's owner id, and never touches the pairing, the keys or the offline queue (D9).
   * Safe to call twice. Runs every step and rethrows the first failure afterwards, like
   * `PairingStore.wipe()`.
   */
  async clearForLogout(): Promise<void> {
    const failures: unknown[] = [];
    const steps: (() => Promise<void>)[] = [
      ...ACCOUNT_KEYS.map((key) => () => this.storage.deleteItem(key)),
      this.clearCaches,
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw failures[0];
    }
  }

  // --- storage helpers ---

  /** Writes one value after the Android size check (see the module note). */
  private async put(key: string, value: string): Promise<void> {
    const bytes = utf8Length(value);
    if (bytes > MAX_SECURE_VALUE_BYTES) {
      throw new Error(
        `secure-store value for ${key} is ${bytes} bytes; the limit is ${MAX_SECURE_VALUE_BYTES}`,
      );
    }
    await this.storage.setItem(key, value);
  }

  /** Parses a JSON item; a corrupt or ill-shaped one is deleted and read as absent. */
  private async readJson<T>(key: string, check: (value: unknown) => value is T): Promise<T | null> {
    const raw = await this.storage.getItem(key);
    if (raw == null) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (!check(parsed)) {
      await this.storage.deleteItem(key);
      return null;
    }
    return parsed;
  }
}

// --- picking and validation ---

/** Exactly the profile fields, so nothing the server adds later is stored by accident. */
export function toProfile(value: AccountProfile): AccountProfile {
  const profile: AccountProfile = {
    userId: value.userId,
    name: value.name,
    email: value.email,
    role: value.role,
  };
  if (typeof value.phone === 'string' && value.phone.length > 0) {
    profile.phone = value.phone;
  }
  if (typeof value.photoUrl === 'string' && value.photoUrl.length > 0) {
    profile.photoUrl = value.photoUrl;
  }
  return profile;
}

/** Exactly the {@link StoredWorkerState} fields of a server answer; `account`, `notifications` and `null`s are dropped. */
export function toStoredState(value: WorkerStateLike): StoredWorkerState {
  const stored: StoredWorkerState = {
    state: value.state,
    modules: Array.isArray(value.modules) ? [...value.modules] : [],
  };
  if (value.request != null) {
    stored.request = value.request;
  }
  if (value.lastOutcome != null) {
    stored.lastOutcome = value.lastOutcome;
  }
  if (value.shop != null) {
    stored.shop = value.shop;
  }
  if (value.employee != null) {
    stored.employee = value.employee;
  }
  if (value.pairing != null) {
    stored.pairing = value.pairing;
  }
  if (value.today != null) {
    stored.today = value.today;
  }
  if (typeof value.serverTime === 'string') {
    stored.serverTime = value.serverTime;
  }
  return stored;
}

const WORKER_STATES: readonly string[] = ['NO_SHOP', 'PENDING', 'ACTIVE', 'STAFF_NO_EMPLOYEE'];

export function isWorkerStateName(value: unknown): value is WorkerStateName {
  return typeof value === 'string' && WORKER_STATES.includes(value);
}

function isProfile(value: unknown): value is AccountProfile {
  if (!isObject(value)) {
    return false;
  }
  return (
    isNonEmptyText(value['userId']) &&
    typeof value['name'] === 'string' &&
    typeof value['email'] === 'string' &&
    isNonEmptyText(value['role']) &&
    (value['phone'] === undefined || typeof value['phone'] === 'string') &&
    (value['photoUrl'] === undefined || typeof value['photoUrl'] === 'string')
  );
}

function isStoredState(value: unknown): value is StoredWorkerState {
  if (!isObject(value)) {
    return false;
  }
  return (
    isWorkerStateName(value['state']) &&
    Array.isArray(value['modules']) &&
    value['modules'].every((module: unknown) => typeof module === 'string') &&
    (value['request'] === undefined || isObject(value['request'])) &&
    (value['lastOutcome'] === undefined || isObject(value['lastOutcome'])) &&
    (value['shop'] === undefined || isObject(value['shop'])) &&
    (value['employee'] === undefined || isObject(value['employee'])) &&
    (value['pairing'] === undefined || isObject(value['pairing'])) &&
    (value['today'] === undefined || isObject(value['today']))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Bytes of the UTF-8 encoding, without `TextEncoder` (not on every Hermes build). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one 4-byte character.
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

async function noop(): Promise<void> {
  // no caches to clear (tests without a database)
}

// No module-level singleton on purpose: the app's one store is built in `src/app/deps.ts` where
// the history and notifications caches exist, so `clearForLogout()` always has `clearCaches`:
//   new AuthStore({ clearCaches: async () => { await historyCache.clear(); await notificationsCache.clear(); } })
