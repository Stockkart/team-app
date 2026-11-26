import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WORKER_SERVER_MESSAGES } from '@stockkart/attendance-protocol';

import { harness, REQUEST, type Harness } from '../../test-support/join-harness';
import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { inferAccountErrorCode } from '../api/accountClient';
import { NotReachable, ServerRefusal } from '../api/transport';
import { STRINGS_EN, t } from '../i18n';
import type { CachedNotification } from '../state/NotificationsCache';
import type { StoredWorkerState } from '../state/authStore';
import { TOKENS, type ColorScheme } from '../theme';
import { WAITING_POLL_MS } from './usePolling';
import { WaitingScreen } from './WaitingScreen';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PENDING: StoredWorkerState = { state: 'PENDING', modules: [], request: REQUEST };

function notification(id: string, text: string, createdAt: string): CachedNotification {
  return { id, text, type: 'JOIN_REQUEST_APPROVED', createdAt, read: false };
}

function renderWaiting(
  h: Harness,
  options: { state?: StoredWorkerState; scheme?: ColorScheme } = {},
) {
  return renderThemed(
    <WaitingScreen deps={h.deps} shell={h.shell} state={options.state ?? PENDING} />,
    options.scheme,
  );
}

describe('WaitingScreen (R3.5, R3.6, R6.3)', () => {
  it('shows the shop, the requested date, Withdraw request and Log out; no primary button, nothing else', () => {
    const h = harness();
    renderWaiting(h);
    expect(screen.getByText('Waiting for Sri Ganesh Stores to accept you')).toBeTruthy();
    // 2025-05-12T08:00Z is 13:30 the same day in Asia/Kolkata.
    expect(screen.getByText('Requested on Mon, 12 May 2025')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      STRINGS_EN['waiting.withdraw'],
      STRINGS_EN['common.logOut'],
    ]);
    expect(screen.queryByTestId('screen-waiting-footer')).toBeNull();
  });

  it.each(SCHEMES)(
    'in %s: the card is a warning-tinted StatusCard with an hourglass in warning, centred vertically; Withdraw and Log out in danger (R12.15)',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderWaiting(harness(), { scheme });
      const card = screen.getByTestId('waiting-status');
      expect(tokenNameOf(tokens, styleOf(card).backgroundColor)).toContain('warningSoft');
      expect(radiusNameOf(tokens, styleOf(card).borderRadius)).toContain('card');
      const glyph = styleOf(screen.getByTestId('waiting-status-icon').firstElementChild as Element);
      expect(tokenNameOf(tokens, glyph.borderColor ?? glyph.backgroundColor)).toContain('warning');
      const [title, line] = Array.from(card.querySelectorAll('span'));
      expect(tokenNameOf(tokens, styleOf(title).color)).toContain('textPrimary');
      expect(tokenNameOf(tokens, styleOf(line).color)).toContain('textSecondary');
      const centre = screen.getByTestId('waiting-centre');
      expect(centre.contains(card)).toBe(true);
      expect(styleOf(centre)).toMatchObject({ flex: 1, justifyContent: 'center' });
      for (const id of ['waiting-withdraw', 'waiting-log-out']) {
        expect(
          tokenNameOf(
            tokens,
            styleOf(screen.getByTestId(id).querySelector('span') as Element).color,
          ),
        ).toContain('danger');
      }
    },
  );

  it('Withdraw request asks first; Cancel changes nothing (R3.6, R12.5)', () => {
    const h = harness();
    renderWaiting(h);
    fireEvent.click(screen.getByTestId('waiting-withdraw'));
    expect(
      screen.getByText(t('waiting.withdrawQuestion', { shopName: 'Sri Ganesh Stores' })),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId('waiting-withdraw-sheet-cancel'));
    expect(h.account.withdraw).not.toHaveBeenCalled();
    expect(h.shell.refresh).not.toHaveBeenCalled();
  });

  it('confirming withdraws the request once and re-reads the state (R3.6)', async () => {
    const h = harness();
    renderWaiting(h);
    fireEvent.click(screen.getByTestId('waiting-withdraw'));
    fireEvent.click(screen.getByTestId('waiting-withdraw-sheet-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.withdraw).toHaveBeenCalledTimes(1);
    expect(h.account.withdraw).toHaveBeenCalledWith(REQUEST.id);
  });

  it('"already handled" re-reads without an error; not reachable shows the line and keeps the screen', async () => {
    const h = harness();
    h.account.withdraw.mockRejectedValueOnce(
      new ServerRefusal(
        409,
        WORKER_SERVER_MESSAGES.HR_REQUEST_ALREADY_HANDLED,
        inferAccountErrorCode,
      ),
    );
    renderWaiting(h);
    fireEvent.click(screen.getByTestId('waiting-withdraw'));
    fireEvent.click(screen.getByTestId('waiting-withdraw-sheet-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('waiting-error')).toBeNull();

    h.account.withdraw.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    fireEvent.click(screen.getByTestId('waiting-withdraw'));
    fireEvent.click(screen.getByTestId('waiting-withdraw-sheet-confirm'));
    expect((await screen.findByTestId('waiting-error')).textContent).toBe(
      STRINGS_EN['common.notReachable'],
    );
    expect(h.shell.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('waiting-withdraw')).toBeTruthy();
  });

  it('Log out confirms, then ends the session, clears the account set and re-reads', async () => {
    const h = harness();
    renderWaiting(h);
    fireEvent.click(screen.getByTestId('waiting-log-out'));
    fireEvent.click(screen.getByTestId('waiting-log-out-sheet-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.logout).toHaveBeenCalledTimes(1);
    expect(h.authStore.clearForLogout).toHaveBeenCalledTimes(1);
  });

  describe('polling (R3.10, R10.4)', () => {
    it('re-reads the state every 60 s while mounted and stops on unmount', async () => {
      vi.useFakeTimers();
      const h = harness();
      const { unmount } = renderWaiting(h);
      // Mount: the banners are fetched once; the state is the shell's (no read from here).
      await act(async () => undefined);
      expect(h.shell.refresh).not.toHaveBeenCalled();
      expect(h.account.notifications).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(WAITING_POLL_MS - 1);
      });
      expect(h.shell.refresh).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(h.shell.refresh).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(WAITING_POLL_MS * 2);
      });
      expect(h.shell.refresh).toHaveBeenCalledTimes(3);
      // The notifications follow the same tick (mount + 3 ticks).
      expect(h.account.notifications).toHaveBeenCalledTimes(4);

      unmount();
      await act(async () => {
        vi.advanceTimersByTime(WAITING_POLL_MS * 5);
      });
      expect(h.shell.refresh).toHaveBeenCalledTimes(3);
    });
  });

  describe('notification banners (R10.1)', () => {
    it('draws the unread ones newest first, three at most, and "and N more"', async () => {
      const h = harness({
        unread: [
          notification('n1', 'Oldest', '2025-05-01T09:00:00Z'),
          notification('n2', 'Second', '2025-05-02T09:00:00Z'),
          notification('n3', 'Third', '2025-05-03T09:00:00Z'),
          notification('n4', 'Newest', '2025-05-04T09:00:00Z'),
        ],
      });
      renderWaiting(h);
      const stack = await screen.findByTestId('waiting-banners');
      const texts = () =>
        Array.from(stack.querySelectorAll('button'), (button) => button.textContent);
      await waitFor(() => expect(texts()).toHaveLength(3));
      expect(texts()).toEqual(['Newest', 'Third', 'Second']);
      expect(screen.getByTestId('waiting-banners-more').textContent).toBe(
        t('banner.more', { count: 1 }),
      );
    });

    it('tapping a banner marks it read on the server and in the cache, removes it, and re-reads the state', async () => {
      const h = harness({
        unread: [notification('n1', 'Sri Ganesh Stores accepted you', '2025-05-12T09:00:00Z')],
      });
      renderWaiting(h);
      fireEvent.click(await screen.findByTestId('waiting-banners-n1'));
      await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
      expect(h.account.markRead).toHaveBeenCalledWith('n1');
      expect(h.notificationsCache.markRead).toHaveBeenCalledWith('n1');
      expect(screen.queryByTestId('waiting-banners-n1')).toBeNull();
    });

    it('a server that is not reachable leaves the cached banners as they are', async () => {
      const h = harness({ unread: [notification('n1', 'Cached line', '2025-05-12T09:00:00Z')] });
      h.account.notifications.mockRejectedValue(new NotReachable('TIMEOUT'));
      renderWaiting(h);
      expect((await screen.findByTestId('waiting-banners-n1')).textContent).toBe('Cached line');
      expect(h.notificationsCache.replaceAll).not.toHaveBeenCalled();
    });
  });
});
