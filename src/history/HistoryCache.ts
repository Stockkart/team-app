/**
 * The history screen's cache (design "Attendance app" table, `HistoryScreen`: "Cached copy in
 * SQLite for display only", R4.10, R9.3): the worker's own punches of the last 31 calendar days,
 * as the server last answered them, so the screen can still show them when the server is not
 * reachable. It is never a source of truth: every open of the screen reads the server first and
 * replaces the cache with the answer ({@link replaceAll}); only when that read gets no answer is
 * the cache shown.
 *
 * What a row holds, and nothing else (R9.3): the punch id, the instant (epoch ms, for ordering),
 * the attendance date and `HH:mm` in Asia/Kolkata, the direction, the flags and whether the punch
 * counted. No distance, no accuracy, no coordinates, no device model.
 *
 * Rows older than the window are pruned on every write and on {@link prune}, so the cache never
 * holds more than 31 days (R9.3 "the worker's own punches from the last 31 calendar days").
 *
 * `punch_history_meta` holds one row, `fetched_at`: the phone clock when {@link replaceAll} last
 * stored a server answer. The History module shows it as "Last updated 09:40" when the server is
 * not reachable (worker-app R6.7). {@link upsert} (a queued punch the sync worker got answered) is
 * not a fetch and leaves it alone; {@link clear} removes it with the rows.
 *
 * The table lives in the same SQLite file as the offline queue (`QUEUE_DB_NAME`), so the one
 * `deleteQueue` step of `PairingStore.wipe()` removes both (R3.3, R9.6); log out keeps the file
 * and calls {@link clear} instead (worker-app R9.5). Pure apart from the injected
 * {@link SqlDatabase}: the phone passes the queue's `expo-sqlite` connection
 * (`src/queue/expoDb.ts`), tests pass `MemoryDatabase`.
 */
import type { PunchDirection, PunchResponse } from '@stockkart/attendance-protocol';

import type { SqlDatabase } from '../queue/db';
import { kolkataDate, kolkataTime, parseInstant } from './kolkataDates';

export const PUNCH_HISTORY_TABLE = 'punch_history';
export const PUNCH_HISTORY_META_TABLE = 'punch_history_meta';

/** The one `punch_history_meta` key: epoch ms of the last server answer stored. */
const FETCHED_AT_KEY = 'fetched_at';

/** The schema, idempotent; run once per opened connection. */
export const PUNCH_HISTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS ${PUNCH_HISTORY_TABLE} (
  punch_id TEXT PRIMARY KEY NOT NULL,
  punched_at_ms INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  flags TEXT NOT NULL,
  counted INTEGER NOT NULL DEFAULT 1,
  saved_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS punch_history_newest ON ${PUNCH_HISTORY_TABLE} (punched_at_ms);
CREATE TABLE IF NOT EXISTS ${PUNCH_HISTORY_META_TABLE} (
  key TEXT PRIMARY KEY NOT NULL,
  value_ms INTEGER NOT NULL
);
`;

/** One punch as the history screen shows it (R4.10): date, time, direction, flags. */
export interface HistoryEntry {
  punchId: string;
  /** Epoch ms of the punch; the newest-first order key. */
  atMs: number;
  /** `yyyy-MM-dd`, Asia/Kolkata. */
  localDate: string;
  /** `HH:mm`, 24-hour, Asia/Kolkata. */
  localTime: string;
  direction: PunchDirection;
  /** Flag constant names; an unknown name from a newer backend is kept, never dropped. */
  flags: string[];
  /** false = a duplicate within 5 minutes of the previous counted punch (R4.8). */
  counted: boolean;
}

/** A `punch_history` row as SQLite returns it. */
interface PunchHistoryRow {
  punch_id: string;
  punched_at_ms: number;
  local_date: string;
  local_time: string;
  direction: PunchDirection;
  flags: string;
  counted: number;
  saved_at: number;
}

export interface HistoryCacheOptions {
  /** Phone clock in epoch ms; `Date.now` on the phone, a fake in tests. */
  now?: () => number;
}

export class HistoryCache {
  private readonly now: () => number;
  private schemaReady: Promise<void> | undefined;

  constructor(private readonly db: SqlDatabase, options: HistoryCacheOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Replaces the whole cache with the server's answer, in one transaction, keeping only entries
   * whose attendance date is on or after `from` (the start of the 31-day window). A punch id that
   * appears twice is stored once. Records the phone clock as {@link fetchedAt}. Returns what was
   * stored, newest first.
   */
  async replaceAll(entries: readonly HistoryEntry[], from: string): Promise<HistoryEntry[]> {
    await this.ready();
    const kept = dedupe(entries.filter((entry) => entry.localDate >= from));
    const savedAt = this.now();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM ${PUNCH_HISTORY_TABLE}`, []);
      for (const entry of kept) {
        await this.db.runAsync(
          `INSERT INTO ${PUNCH_HISTORY_TABLE} (punch_id, punched_at_ms, local_date, local_time, direction, flags, counted, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.punchId,
            entry.atMs,
            entry.localDate,
            entry.localTime,
            entry.direction,
            JSON.stringify(entry.flags),
            entry.counted ? 1 : 0,
            savedAt,
          ],
        );
      }
      await this.db.runAsync(`DELETE FROM ${PUNCH_HISTORY_META_TABLE} WHERE key = ?`, [
        FETCHED_AT_KEY,
      ]);
      await this.db.runAsync(
        `INSERT INTO ${PUNCH_HISTORY_META_TABLE} (key, value_ms) VALUES (?, ?)`,
        [FETCHED_AT_KEY, savedAt],
      );
    });
    return sortNewestFirst(kept);
  }

  /**
   * Stores one punch the server has just answered (the sync worker's queued punch, R6.7), replacing
   * any entry with the same punch id. Runs two plain statements and opens no transaction of its
   * own, so `PunchQueue.markAnswered` can call it inside the queue's transaction (R9.5;
   * `expo-sqlite` transactions do not nest).
   */
  async upsert(entry: HistoryEntry): Promise<void> {
    await this.ready();
    await this.db.runAsync(`DELETE FROM ${PUNCH_HISTORY_TABLE} WHERE punch_id = ?`, [
      entry.punchId,
    ]);
    await this.db.runAsync(
      `INSERT INTO ${PUNCH_HISTORY_TABLE} (punch_id, punched_at_ms, local_date, local_time, direction, flags, counted, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.punchId,
        entry.atMs,
        entry.localDate,
        entry.localTime,
        entry.direction,
        JSON.stringify(entry.flags),
        entry.counted ? 1 : 0,
        this.now(),
      ],
    );
  }

  /** Deletes entries whose attendance date is before `from`. Returns how many were removed. */
  async prune(from: string): Promise<number> {
    await this.ready();
    const result = await this.db.runAsync(
      `DELETE FROM ${PUNCH_HISTORY_TABLE} WHERE local_date < ?`,
      [from],
    );
    return result.changes;
  }

  /** Every cached entry, newest first (R4.10). */
  async list(): Promise<HistoryEntry[]> {
    await this.ready();
    const rows = await this.db.getAllAsync<PunchHistoryRow>(
      `SELECT * FROM ${PUNCH_HISTORY_TABLE} ORDER BY punched_at_ms DESC, punch_id DESC`,
      [],
    );
    return rows.map(toEntry);
  }

  /** Number of cached entries; for tests and the empty-state decision. */
  async count(): Promise<number> {
    await this.ready();
    const row = await this.db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${PUNCH_HISTORY_TABLE}`,
      [],
    );
    return row?.n ?? 0;
  }

  /**
   * Epoch ms (phone clock) of the last {@link replaceAll}, or null when no server answer has been
   * stored since the cache was last cleared. The "Last updated 09:40" line (worker-app R6.7).
   */
  async fetchedAt(): Promise<number | null> {
    await this.ready();
    const row = await this.db.getFirstAsync<{ value_ms: number }>(
      `SELECT value_ms FROM ${PUNCH_HISTORY_META_TABLE} WHERE key = ?`,
      [FETCHED_AT_KEY],
    );
    return row?.value_ms ?? null;
  }

  /**
   * Deletes every entry and the fetched-at mark. Part of the local wipe path when the file cannot
   * be removed, and the `clearCaches` step of `AuthStore.clearForLogout()` (worker-app R9.5).
   */
  async clear(): Promise<void> {
    await this.ready();
    await this.db.runAsync(`DELETE FROM ${PUNCH_HISTORY_TABLE}`, []);
    await this.db.runAsync(`DELETE FROM ${PUNCH_HISTORY_META_TABLE}`, []);
  }

  private ready(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.db.execAsync(PUNCH_HISTORY_SCHEMA).catch((error: unknown) => {
        this.schemaReady = undefined;
        throw error;
      });
    }
    return this.schemaReady;
  }
}

// --- mapping ---

/**
 * A server `PunchResponse` as a {@link HistoryEntry}. The server's `localDate` and `time` are
 * used when present; otherwise both are worked out from `at` in Asia/Kolkata. Returns null when
 * `at` is not a date, so one bad row never hides the rest.
 */
export function toHistoryEntry(punch: PunchResponse): HistoryEntry | null {
  const atMs = parseInstant(punch.at);
  if (atMs === null || typeof punch.id !== 'string' || punch.id.length === 0) {
    return null;
  }
  const direction: PunchDirection = punch.direction === 'OUT' ? 'OUT' : 'IN';
  return {
    punchId: punch.id,
    atMs,
    localDate: punch.localDate ?? kolkataDate(atMs),
    localTime: punch.time ?? kolkataTime(atMs),
    direction,
    flags: Array.isArray(punch.flags) ? punch.flags.filter(isText) : [],
    counted: punch.counted !== false,
  };
}

/** Maps a server list, dropping unreadable rows, newest first. */
export function toHistoryEntries(punches: readonly PunchResponse[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const punch of punches) {
    const entry = toHistoryEntry(punch);
    if (entry) {
      entries.push(entry);
    }
  }
  return sortNewestFirst(entries);
}

/** Newest first by instant; ties by punch id descending, so the order is total. */
export function sortNewestFirst(entries: readonly HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort(
    (a, b) => b.atMs - a.atMs || (a.punchId < b.punchId ? 1 : a.punchId > b.punchId ? -1 : 0),
  );
}

function dedupe(entries: readonly HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const entry of entries) {
    if (!seen.has(entry.punchId)) {
      seen.add(entry.punchId);
      out.push(entry);
    }
  }
  return out;
}

function toEntry(row: PunchHistoryRow): HistoryEntry {
  return {
    punchId: row.punch_id,
    atMs: row.punched_at_ms,
    localDate: row.local_date,
    localTime: row.local_time,
    direction: row.direction,
    flags: parseFlags(row.flags),
    counted: row.counted !== 0,
  };
}

function parseFlags(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter(isText) : [];
  } catch {
    return [];
  }
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}
