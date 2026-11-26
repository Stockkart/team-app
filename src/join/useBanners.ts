/**
 * The notification banner stack's data for Waiting (and Home, task 14.3) (R10.1, R10.4, R11.8):
 * the unread rows of `NotificationsCache`, as `Banner` items, newest first; `sync()` fetches
 * `GET /hr/worker/notifications` with the token and replaces the cache (the one source of truth
 * is the server; the cache only bridges launches and no-network moments); `markRead(id)` mirrors a
 * tap to the server and the cache so the banner disappears at once.
 *
 * Every step is best effort: a cache that cannot be opened or a server that is not reachable leaves
 * the stack as it was, never an error on the screen (the state read decides the screen; banners are
 * extra). A 401 is handed to `shell.handleError` like every other account call (R9.3).
 *
 * `sync()` runs once on mount and whenever the caller asks (the Waiting screen's poll tick); the
 * app's foreground event is subscribed to here too, so banners refresh with the state (R10.4).
 *
 * React only; no React Native import.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AccountClient } from '../api/accountClient';
import type { ForegroundSource, ShellActions } from '../app/useAppState';
import type { BannerItem } from '../components';
import { toCachedNotifications, type NotificationsCache } from '../state/NotificationsCache';

export interface BannerDeps {
  account: Pick<AccountClient, 'notifications' | 'markRead'>;
  notificationsCache: Pick<NotificationsCache, 'unread' | 'replaceAll' | 'markRead'>;
  foreground?: ForegroundSource;
}

export interface Banners {
  items: BannerItem[];
  /** Fetches the server list and redraws. Resolves when done; never rejects. */
  sync(): Promise<void>;
  /** Marks one notification read on the server and in the cache, then redraws. Never rejects. */
  markRead(id: string): Promise<void>;
}

export function useBanners(deps: BannerDeps, shell: Pick<ShellActions, 'handleError'>): Banners {
  const [items, setItems] = useState<BannerItem[]>([]);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const live = useRef(true);

  const redraw = useCallback(async (): Promise<void> => {
    try {
      const unread = await depsRef.current.notificationsCache.unread();
      if (live.current) {
        setItems(
          unread.map((row) => ({
            id: row.id,
            text: row.text,
            createdAt: row.createdAt,
            type: row.type,
          })),
        );
      }
    } catch {
      // The cache could not be read: keep what is drawn.
    }
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    try {
      const answer = await depsRef.current.account.notifications();
      await depsRef.current.notificationsCache.replaceAll(toCachedNotifications(answer.items));
    } catch (error) {
      if (shellRef.current.handleError(error)) {
        return;
      }
      // Not reachable, or no cache: the stack stays as it was.
    }
    await redraw();
  }, [redraw]);

  const markRead = useCallback(async (id: string): Promise<void> => {
    try {
      await depsRef.current.account.markRead(id);
    } catch (error) {
      if (shellRef.current.handleError(error)) {
        return;
      }
      // The server will be told on the next tap or sync; the banner still goes.
    }
    try {
      await depsRef.current.notificationsCache.markRead(id);
    } catch {
      // No cache: nothing to mirror.
    }
    if (live.current) {
      setItems((current) => current.filter((item) => item.id !== id));
    }
  }, []);

  // Mount: draw the cache first (instant), then the server's list.
  useEffect(() => {
    live.current = true;
    void redraw().then(() => sync());
    return () => {
      live.current = false;
    };
  }, [redraw, sync]);

  // Foreground: the state re-resolves in the shell; banners follow (R10.4).
  useEffect(() => {
    const source = deps.foreground;
    if (!source) {
      return undefined;
    }
    return source.subscribe(() => {
      void sync();
    });
  }, [deps.foreground, sync]);

  return { items, sync, markRead };
}
