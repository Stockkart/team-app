/**
 * Fakes for the Join, Waiting and Blocked screen tests (`src/join/*.test.tsx`, task 14.2; task
 * 14.10 may reuse them): the part of `AppDeps` these screens touch, built from `vi.fn` spies with
 * sensible defaults, and a `ShellActions` spy. Nothing here reaches the secure store, SQLite or the
 * network.
 */
import { vi } from 'vitest';

import type {
  JoinRequestSelfResponse,
  ShopLookupResponse,
  WorkerNotificationsResponse,
} from '@stockkart/attendance-protocol';

import type { AppDeps } from '../src/app/deps';
import type { ShellActions } from '../src/app/useAppState';
import type { CachedNotification } from '../src/state/NotificationsCache';

export const SHOP = { shopId: 's1', shopName: 'Sri Ganesh Stores', ownerFirstName: 'Ramesh' };
export const SHOP_2 = { shopId: 's2', shopName: 'Ganesh Traders', ownerFirstName: 'Ramesh' };

export const PROFILE = {
  userId: 'u1',
  name: 'Priya Sharma',
  email: 'priya@example.in',
  phone: '9876543210',
  role: 'WORKER',
};

export const REQUEST: JoinRequestSelfResponse = {
  id: 'r1',
  shopName: 'Sri Ganesh Stores',
  status: 'PENDING',
  requestedAt: '2025-05-12T08:00:00Z',
};

export function harness(options: { unread?: CachedNotification[] } = {}) {
  const unreadRows: CachedNotification[] = [...(options.unread ?? [])];
  const account = {
    lookupShops: vi.fn<(email: string) => Promise<ShopLookupResponse>>(async () => ({
      shops: [SHOP],
    })),
    createJoinRequest: vi.fn<(shopId: string) => Promise<JoinRequestSelfResponse>>(
      async () => REQUEST,
    ),
    withdraw: vi.fn<(id: string) => Promise<JoinRequestSelfResponse>>(async () => ({
      ...REQUEST,
      status: 'WITHDRAWN',
    })),
    logout: vi.fn(async () => ({ success: true })),
    notifications: vi.fn<() => Promise<WorkerNotificationsResponse>>(async () => ({
      items: unreadRows.map((row) => ({ ...row, type: 'JOIN_REQUEST_APPROVED' as const })),
      unread: unreadRows.length,
    })),
    markRead: vi.fn(async () => ({ read: true })),
    imageSource: vi.fn(async (photoUrl: string) => ({
      uri: `https://api.test.invalid${photoUrl}`,
      headers: { Authorization: 'Bearer tok' },
    })),
  };
  const authStore = {
    dismissedOutcomeId: vi.fn<() => Promise<string | null>>(async () => null),
    setDismissedOutcomeId: vi.fn(async () => undefined),
    clearForLogout: vi.fn(async () => undefined),
  };
  const notificationsCache = {
    unread: vi.fn(async () => [...unreadRows]),
    replaceAll: vi.fn(async (items: readonly CachedNotification[]) => {
      unreadRows.splice(0, unreadRows.length, ...items.filter((item) => !item.read));
      return [...items];
    }),
    markRead: vi.fn(async (id: string) => {
      const at = unreadRows.findIndex((row) => row.id === id);
      if (at >= 0) {
        unreadRows.splice(at, 1);
      }
      return at >= 0;
    }),
  };
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn(() => false),
    confirm: vi.fn(async () => true),
  };
  const deps = { account, authStore, notificationsCache } as unknown as AppDeps;
  return { deps, shell, account, authStore, notificationsCache };
}

export type Harness = ReturnType<typeof harness>;
