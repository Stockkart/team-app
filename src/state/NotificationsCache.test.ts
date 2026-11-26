import { describe, expect, it } from 'vitest';

import { NOTIFICATIONS_CACHE_TABLE } from '../queue/db';
import { MemoryDatabase } from '../queue/memoryDb';
import {
  NotificationsCache,
  sortNewestFirst,
  toCachedNotification,
  toCachedNotifications,
  type CachedNotification,
} from './NotificationsCache';

function note(id: string, createdAt: string, overrides: Partial<CachedNotification> = {}) {
  return {
    id,
    text: `text ${id}`,
    type: 'JOIN_REQUEST_APPROVED',
    createdAt,
    read: false,
    ...overrides,
  } satisfies CachedNotification;
}

function cache(): { cache: NotificationsCache; db: MemoryDatabase } {
  const db = new MemoryDatabase();
  return { cache: new NotificationsCache(db), db };
}

describe('NotificationsCache', () => {
  it('replaceAll stores the server answer and lists it newest first', async () => {
    const { cache: c, db } = cache();
    const older = note('n1', '2025-04-01T04:00:00Z');
    const newer = note('n2', '2025-04-03T03:40:00Z', { type: 'PROFILE_REQUESTED', read: true });
    const middle = note('n3', '2025-04-02T12:30:00Z');

    const stored = await c.replaceAll([older, newer, middle]);

    expect(stored.map((n) => n.id)).toEqual(['n2', 'n3', 'n1']);
    expect(await c.list()).toEqual(stored);
    expect(await c.count()).toBe(3);
    // Nothing but the banner fields is written (R11.8).
    expect(Object.keys(db.dump(NOTIFICATIONS_CACHE_TABLE)[0]).sort()).toEqual([
      'created_at',
      'id',
      'read',
      'text',
      'type',
    ]);
    expect((await c.list())[0]).toMatchObject({ type: 'PROFILE_REQUESTED', read: true });
  });

  it('replaceAll drops the previous content and stores a repeated id once', async () => {
    const { cache: c } = cache();
    await c.replaceAll([note('old', '2025-04-01T04:00:00Z')]);
    const stored = await c.replaceAll([
      note('dup', '2025-04-03T03:00:00Z'),
      note('dup', '2025-04-03T03:00:00Z', { text: 'second' }),
    ]);
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('text dup');
    expect((await c.list()).map((n) => n.id)).toEqual(['dup']);
  });

  it('upsert adds one notification and replaces an entry with the same id, without a transaction', async () => {
    const { cache: c, db } = cache();
    await c.replaceAll([note('kept', '2025-04-02T04:00:00Z')]);

    await c.upsert(note('new', '2025-04-03T03:40:00Z'));
    await c.upsert(note('new', '2025-04-03T03:40:00Z', { read: true }));

    const listed = await c.list();
    expect(listed.map((n) => n.id)).toEqual(['new', 'kept']);
    expect(listed[0].read).toBe(true);
    expect(await c.count()).toBe(2);

    await db.withTransactionAsync(async () => {
      await c.upsert(note('inside', '2025-04-03T03:41:00Z'));
    });
    expect(await c.count()).toBe(3);
  });

  it('unread lists the unread ones newest first and markRead removes one from it (R10.1)', async () => {
    const { cache: c } = cache();
    await c.replaceAll([
      note('a', '2025-04-01T04:00:00Z'),
      note('b', '2025-04-02T04:00:00Z', { read: true }),
      note('c', '2025-04-03T04:00:00Z'),
    ]);
    expect((await c.unread()).map((n) => n.id)).toEqual(['c', 'a']);

    expect(await c.markRead('c')).toBe(true);
    expect(await c.markRead('missing')).toBe(false);

    expect((await c.unread()).map((n) => n.id)).toEqual(['a']);
    expect((await c.list()).find((n) => n.id === 'c')?.read).toBe(true);
    expect(await c.count()).toBe(3);
  });

  it('clear empties the table', async () => {
    const { cache: c } = cache();
    await c.replaceAll([note('x', '2025-04-03T03:00:00Z')]);
    await c.clear();
    expect(await c.count()).toBe(0);
    expect(await c.list()).toEqual([]);
    expect(await c.unread()).toEqual([]);
  });

  it('a schema failure is retried on the next call rather than cached', async () => {
    const db = new MemoryDatabase();
    let fail = true;
    const original = db.execAsync.bind(db);
    db.execAsync = async (source: string) => {
      if (fail) {
        fail = false;
        throw new Error('disk busy');
      }
      return original(source);
    };
    const c = new NotificationsCache(db);
    await expect(c.count()).rejects.toThrow('disk busy');
    expect(await c.count()).toBe(0);
  });
});

describe('toCachedNotification', () => {
  const item = {
    id: 'n1',
    type: 'JOIN_REQUEST_APPROVED',
    text: 'Sri Ganesh Stores accepted you',
    createdAt: '2025-04-03T03:42:08Z',
    read: false,
    joinRequestId: 'r1',
  };

  it('keeps the banner fields only; a missing read is unread; an unknown type is kept', () => {
    expect(toCachedNotification(item)).toEqual({
      id: 'n1',
      type: 'JOIN_REQUEST_APPROVED',
      text: 'Sri Ganesh Stores accepted you',
      createdAt: '2025-04-03T03:42:08Z',
      read: false,
    });
    expect(toCachedNotification({ ...item, read: null })?.read).toBe(false);
    expect(toCachedNotification({ ...item, read: true })?.read).toBe(true);
    expect(toCachedNotification({ ...item, type: 'NEW_TYPE' })?.type).toBe('NEW_TYPE');
  });

  it('returns null for an unreadable row and drops it from the list', () => {
    expect(toCachedNotification({ ...item, id: '' })).toBeNull();
    expect(toCachedNotification({ ...item, text: undefined as unknown as string })).toBeNull();
    const list = toCachedNotifications([
      item,
      { ...item, id: 'bad', createdAt: undefined as unknown as string },
      { ...item, id: 'n2', createdAt: '2025-04-04T03:42:08Z' },
    ]);
    expect(list.map((n) => n.id)).toEqual(['n2', 'n1']);
  });

  it('sortNewestFirst has a total order', () => {
    const list = [
      note('a', '2025-04-01T03:00:00Z'),
      note('c', '2025-04-03T03:00:00Z'),
      note('b', '2025-04-03T03:00:00Z'),
    ];
    expect(sortNewestFirst(list).map((n) => n.id)).toEqual(['c', 'b', 'a']);
  });
});
