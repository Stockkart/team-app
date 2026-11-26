/**
 * The database behind the offline punch queue (design "Attendance app" table, `PunchQueue`;
 * R6.2–R6.16, R9.5).
 *
 * `SqlDatabase` is the slice of `expo-sqlite`'s `SQLiteDatabase` the queue uses, named and typed
 * the same way, so the real database object satisfies it as is (`./expoDb.ts`) and tests run the
 * same SQL against the in-memory adapter (`./memoryDb.ts`). Positional `?` parameters only; the
 * values are text, numbers and NULL, which is all the queue stores.
 *
 * One table, `punch_queue`, one row per punch saved while the server was not reachable:
 *
 * | Column            | Holds                                                                        |
 * | ----------------- | ---------------------------------------------------------------------------- |
 * | `punch_id`        | the app-made UUID of the punch (R5.6); primary key, so a punch is saved once |
 * | `payload`         | JSON of the ten signed `AppPunchFields`: distance and accuracy, never coordinates (R9.2, R9.5) |
 * | `signature`       | Base64 DER signature by the punch key, made before the row exists           |
 * | `phone_time`      | `phoneTime` again, for the oldest-first send order (R6.5)                    |
 * | `direction_guess` | `IN` or `OUT`: what the phone guessed, for the home-screen label only (R6.4) |
 * | `state`           | `WAITING` (to be sent) or `REFUSED` (answered with a refusal, shown until OK) |
 * | `refusal_message` | the server's refusal text, word for word (R6.13)                            |
 * | `attempts`        | failed sends so far (R6.15)                                                  |
 * | `next_attempt_at` | epoch ms before which the row is not sent again (R6.15)                     |
 * | `created_at`      | epoch ms of the save, phone clock                                            |
 *
 * The same file also holds the history cache (`src/history/HistoryCache.ts`) and, since the worker
 * app, the notifications cache (`notifications_cache`, {@link NOTIFICATIONS_CACHE_SCHEMA}; the
 * class is `src/state/NotificationsCache.ts`): the worker's unread notification texts for the
 * banners on Waiting and Home (R10.1, R11.8). The file is deleted as a whole by
 * `PairingStore.wipe()`; log out keeps the file (the waiting punches stay, R9.5) and empties the
 * two caches through `AuthStore.clearForLogout()`.
 */

/** A bound value: `SQLiteBindValue` without blobs and booleans, which the queue never stores. */
export type SqlValue = string | number | null;

/**
 * Positional parameters for the `?` placeholders of a statement, in order. A mutable array on
 * purpose: that is what makes `expo-sqlite`'s `SQLiteBindParams` accept it without a wrapper.
 */
export type SqlParams = SqlValue[];

/** What `runAsync` reports; the queue reads `changes` only. */
export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

/**
 * The `expo-sqlite` async surface the queue needs. `SQLiteDatabase` satisfies this interface
 * structurally (its `params` accept a wider value type), so no wrapper is needed on the phone.
 */
export interface SqlDatabase {
  /** Runs one or more `;`-separated statements without parameters (schema). */
  execAsync(source: string): Promise<void>;
  /** Runs one write statement. */
  runAsync(source: string, params: SqlParams): Promise<SqlRunResult>;
  /** Runs one read statement and returns every row. */
  getAllAsync<T>(source: string, params: SqlParams): Promise<T[]>;
  /** Runs one read statement and returns the first row, or null when there is none. */
  getFirstAsync<T>(source: string, params: SqlParams): Promise<T | null>;
  /**
   * Runs `task` inside `BEGIN … COMMIT`; a throw rolls back and is rethrown. Not re-entrant, like
   * `expo-sqlite`.
   */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  /** Closes the connection; the queue calls it before the file is deleted. */
  closeAsync(): Promise<void>;
}

/** The SQLite file name (inside the app's private SQLite directory, never shared storage, R9.3). */
export const QUEUE_DB_NAME = 'attendance-queue.db';

export const PUNCH_QUEUE_TABLE = 'punch_queue';

/** Row states. A refused row is not "waiting" anywhere (R6.13). */
export type QueueRowState = 'WAITING' | 'REFUSED';

/** The schema, idempotent; run once per opened connection. */
export const PUNCH_QUEUE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ${PUNCH_QUEUE_TABLE} (
  punch_id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  signature TEXT NOT NULL,
  phone_time TEXT NOT NULL,
  direction_guess TEXT NOT NULL CHECK (direction_guess IN ('IN', 'OUT')),
  state TEXT NOT NULL CHECK (state IN ('WAITING', 'REFUSED')),
  refusal_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS punch_queue_send_order ON ${PUNCH_QUEUE_TABLE} (state, phone_time, created_at);
`;

/** A `punch_queue` row as SQLite returns it (snake_case, nullable text). */
export interface PunchQueueRow {
  punch_id: string;
  payload: string;
  signature: string;
  phone_time: string;
  direction_guess: 'IN' | 'OUT';
  state: QueueRowState;
  refusal_message: string | null;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
}

export const NOTIFICATIONS_CACHE_TABLE = 'notifications_cache';

/**
 * The notifications cache (R10.1, R11.8): one row per notification the server listed for the
 * account, as the server last answered it. `created_at` is the server's ISO instant (newest-first
 * order), `read` is `0` or `1`. Nothing else is kept: no shop id, no employee id, no recipient.
 * Idempotent; run once per opened connection.
 */
export const NOTIFICATIONS_CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ${NOTIFICATIONS_CACHE_TABLE} (
  id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notifications_cache_newest ON ${NOTIFICATIONS_CACHE_TABLE} (read, created_at);
`;

/** A `notifications_cache` row as SQLite returns it. */
export interface NotificationsCacheRow {
  id: string;
  text: string;
  type: string;
  created_at: string;
  read: number;
}
