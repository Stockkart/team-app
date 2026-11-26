/**
 * The worker's notifications as the server last listed them (worker-app R10.1, R10.4, R11.8), in
 * the app's SQLite file (`notifications_cache`, schema in `src/queue/db.ts`), so the banner stack
 * on Waiting and Home can draw the unread lines before the next fetch and while the server is not
 * reachable. Never a source of truth: `GET /hr/worker/notifications` replaces the cache on every
 * launch, foreground and Waiting refresh ({@link replaceAll}); {@link markRead} mirrors a
 * successful `POST /notifications/{id}/read` so the banner disappears at once.
 *
 * What a row holds, and nothing else (R11.8 "unread notification texts"): the notification id,
 * the server's text, its type, its ISO instant and the read flag. No shop, employee or recipient
 * id, no pay, no phone number or e-mail (the server never puts those in a text, R10.3).
 *
 * Cleared by `AuthStore.clearForLogout()` (R9.5); removed with the file by `PairingStore.wipe()`.
 * Pure apart from the injected {@link SqlDatabase}: the phone passes the queue's `expo-sqlite`
 * connection (`src/queue/expoDb.ts`), tests pass `MemoryDatabase`. Same pattern as `HistoryCache`.
 */
import {
  NOTIFICATIONS_CACHE_SCHEMA,
  NOTIFICATIONS_CACHE_TABLE,
  type NotificationsCacheRow,
  type SqlDatabase,
} from '../queue/db';

/** One notification as the banners show it; `createdAt` is the server's ISO instant. */
export interface CachedNotification {
  id: string;
  text: string;
  /** The server's `HrNotificationType` name; an unknown name from a newer backend is kept. */
  type: string;
  createdAt: string;
  read: boolean;
}

/** The shape `GET /hr/worker/notifications` items have; mapped by {@link toCachedNotification}. */
export interface NotificationLike {
  id: string;
  text: string;
  type: string;
  createdAt: string;
  read?: boolean | null;
}

export class NotificationsCache {
  private schemaReady: Promise<void> | undefined;

  constructor(private readonly db: SqlDatabase) {}

  /**
   * Replaces the whole cache with the server's answer, in one transaction. An id that appears
   * twice is stored once (the first wins). Returns what was stored, newest first.
   */
  async replaceAll(items: readonly CachedNotification[]): Promise<CachedNotification[]> {
    await this.ready();
    const kept = dedupe(items);
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`DELETE FROM ${NOTIFICATIONS_CACHE_TABLE}`, []);
      for (const item of kept) {
        await this.insert(item);
      }
    });
    return sortNewestFirst(kept);
  }

  /** Stores one notification, replacing any row with the same id. No transaction of its own. */
  async upsert(item: CachedNotification): Promise<void> {
    await this.ready();
    await this.db.runAsync(`DELETE FROM ${NOTIFICATIONS_CACHE_TABLE} WHERE id = ?`, [item.id]);
    await this.insert(item);
  }

  /** Every cached notification, newest first. */
  async list(): Promise<CachedNotification[]> {
    await this.ready();
    return this.rows(
      `SELECT * FROM ${NOTIFICATIONS_CACHE_TABLE} ORDER BY created_at DESC, id DESC`,
    );
  }

  /** The unread ones, newest first: what the banner stack draws (R10.1). */
  async unread(): Promise<CachedNotification[]> {
    await this.ready();
    return this.rows(
      `SELECT * FROM ${NOTIFICATIONS_CACHE_TABLE} WHERE read = 0 ORDER BY created_at DESC, id DESC`,
    );
  }

  /** Marks one notification read. Returns false when no row has that id. */
  async markRead(id: string): Promise<boolean> {
    await this.ready();
    const result = await this.db.runAsync(
      `UPDATE ${NOTIFICATIONS_CACHE_TABLE} SET read = 1 WHERE id = ?`,
      [id],
    );
    return result.changes > 0;
  }

  /** Number of cached notifications; for tests and the empty-state decision. */
  async count(): Promise<number> {
    await this.ready();
    const row = await this.db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${NOTIFICATIONS_CACHE_TABLE}`,
      [],
    );
    return row?.n ?? 0;
  }

  /** Deletes every row: the `clearCaches` step of `AuthStore.clearForLogout()` (R9.5). */
  async clear(): Promise<void> {
    await this.ready();
    await this.db.runAsync(`DELETE FROM ${NOTIFICATIONS_CACHE_TABLE}`, []);
  }

  private async insert(item: CachedNotification): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO ${NOTIFICATIONS_CACHE_TABLE} (id, text, type, created_at, read) VALUES (?, ?, ?, ?, ?)`,
      [item.id, item.text, item.type, item.createdAt, item.read ? 1 : 0],
    );
  }

  private async rows(sql: string): Promise<CachedNotification[]> {
    const rows = await this.db.getAllAsync<NotificationsCacheRow>(sql, []);
    return rows.map(toNotification);
  }

  private ready(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.db.execAsync(NOTIFICATIONS_CACHE_SCHEMA).catch((error: unknown) => {
        this.schemaReady = undefined;
        throw error;
      });
    }
    return this.schemaReady;
  }
}

// --- mapping ---

/**
 * A server notification as a {@link CachedNotification}. Returns null when the row has no id, text
 * or instant, so one bad row never hides the rest. A missing `read` is unread.
 */
export function toCachedNotification(item: NotificationLike): CachedNotification | null {
  if (!isText(item.id) || item.id.length === 0 || !isText(item.text) || !isText(item.createdAt)) {
    return null;
  }
  return {
    id: item.id,
    text: item.text,
    type: isText(item.type) ? item.type : 'UNKNOWN',
    createdAt: item.createdAt,
    read: item.read === true,
  };
}

/** Maps a server list, dropping unreadable rows, newest first. */
export function toCachedNotifications(items: readonly NotificationLike[]): CachedNotification[] {
  const out: CachedNotification[] = [];
  for (const item of items) {
    const mapped = toCachedNotification(item);
    if (mapped) {
      out.push(mapped);
    }
  }
  return sortNewestFirst(out);
}

/** Newest first by ISO instant (same format from one server, so text order is time order); ties by id descending. */
export function sortNewestFirst(items: readonly CachedNotification[]): CachedNotification[] {
  return [...items].sort(
    (a, b) =>
      (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

function dedupe(items: readonly CachedNotification[]): CachedNotification[] {
  const seen = new Set<string>();
  const out: CachedNotification[] = [];
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function toNotification(row: NotificationsCacheRow): CachedNotification {
  return {
    id: row.id,
    text: row.text,
    type: row.type,
    createdAt: row.created_at,
    read: row.read !== 0,
  };
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}
