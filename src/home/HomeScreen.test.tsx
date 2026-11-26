import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HrNotificationType } from '@stockkart/attendance-protocol';

import { gradientOf } from '../../test-support/expo-linear-gradient';
import { harness, PROFILE, type Harness } from '../../test-support/join-harness';
import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { STRINGS_EN, t } from '../i18n';
import type { CachedNotification } from '../state/NotificationsCache';
import type { StoredWorkerState } from '../state/authStore';
import { TOKENS, type ColorScheme } from '../theme';
import { HOME_AVATAR_SIZE, pairs, todayLine, WorkerHomeScreen } from './HomeScreen';

const INSETS = vi.hoisted(() => ({ top: 24, bottom: 0, left: 0, right: 0 }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => INSETS,
}));

afterEach(cleanup);

// 2025-05-12 14:30 IST.
const NOW = Date.UTC(2025, 4, 12, 9, 0, 0);

const ACTIVE: StoredWorkerState = {
  state: 'ACTIVE',
  shop: { shopId: 's1', shopName: 'Sri Ganesh Stores' },
  employee: {
    employeeId: 'e1',
    code: 'EMP-015',
    name: 'Priya Sharma',
    joinDate: '2025-05-12',
    status: 'ACTIVE',
  },
  modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
  pairing: { state: 'NOT_PAIRED' },
  today: { date: '2025-05-12', in: '09:12', out: null, nextDirection: 'OUT' },
};

function notification(
  id: string,
  text: string,
  type: HrNotificationType,
): CachedNotification & { type: HrNotificationType } {
  return { id, text, type, createdAt: '2025-05-12T08:00:00Z', read: false };
}

function renderHome(
  h: Harness,
  options: {
    state?: StoredWorkerState;
    offline?: boolean;
    now?: number;
    scheme?: ColorScheme;
  } = {},
) {
  const onOpenModule = vi.fn();
  const view = renderThemed(
    <WorkerHomeScreen
      deps={h.deps}
      shell={h.shell}
      state={options.state ?? ACTIVE}
      profile={PROFILE}
      offline={options.offline ?? false}
      onOpenModule={onOpenModule}
      now={() => options.now ?? NOW}
    />,
    options.scheme,
  );
  return { ...view, onOpenModule };
}

describe('WorkerHomeScreen (R6.4–R6.7)', () => {
  it('greets by the IST hour and first name, and shows the shop and today\u2019s date (Asia/Kolkata) in the header (R12.16)', () => {
    renderHome(harness());
    // 14:30 IST: the afternoon greeting, the first name only.
    expect(screen.getByTestId('home-greeting').textContent).toBe('Good afternoon, Priya');
    expect(screen.getByRole('heading', { name: 'Good afternoon, Priya' })).toBeTruthy();
    expect(screen.getByTestId('home-shop').textContent).toBe('Sri Ganesh Stores');
    expect(screen.getByTestId('home-date').textContent).toBe('Mon, 12 May 2025');
    expect(screen.getByRole('image', { name: 'Priya Sharma' })).toBeTruthy();
    expect(screen.queryByTestId('home-offline')).toBeNull();
  });

  it('the greeting follows the hour: morning before 12, evening from 17 (R12.16)', () => {
    // 2025-05-12 09:00 IST.
    renderHome(harness(), { now: Date.UTC(2025, 4, 12, 3, 30, 0) });
    expect(screen.getByTestId('home-greeting').textContent).toBe('Good morning, Priya');
    cleanup();
    // 2025-05-12 19:00 IST.
    renderHome(harness(), { now: Date.UTC(2025, 4, 12, 13, 30, 0) });
    expect(screen.getByTestId('home-greeting').textContent).toBe('Good evening, Priya');
  });

  it.each(SCHEMES)(
    'in %s: the header is a brandSoft → accentSoft GradientHeader flush with the status bar, the avatar 56 dp onSoft, the texts textPrimary / textSecondary',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderHome(harness(), { scheme });
      const band = screen.getByTestId('home-header');
      const [from, to] = gradientOf(band)?.colors ?? [];
      expect(tokenNameOf(tokens, from)).toContain('brandSoft');
      expect(tokenNameOf(tokens, to)).toContain('accentSoft');
      // Flush with the status bar: the band carries the inset plus its own 24 dp padding, and the
      // body under it keeps only the 16 dp screen padding.
      expect(styleOf(band).paddingTop).toBe(INSETS.top + tokens.space.lg);
      expect(radiusNameOf(tokens, styleOf(band).borderBottomLeftRadius)).toContain('card');
      expect(styleOf(screen.getByTestId('screen-home-body')).paddingTop).toBe(16);
      expect(band.contains(screen.getByTestId('home-greeting'))).toBe(true);

      const avatar = screen.getByTestId('home-avatar');
      expect(styleOf(avatar)).toMatchObject({ width: HOME_AVATAR_SIZE, height: HOME_AVATAR_SIZE });
      expect(HOME_AVATAR_SIZE).toBe(56);
      expect(tokenNameOf(tokens, styleOf(avatar).backgroundColor)).toContain('brandSoft');
      const initial = avatar.querySelector('span') as Element;
      expect(tokenNameOf(tokens, styleOf(initial).color)).toContain('brand');

      expect(tokenNameOf(tokens, styleOf(screen.getByTestId('home-greeting')).color)).toContain(
        'textPrimary',
      );
      expect(tokenNameOf(tokens, styleOf(screen.getByTestId('home-shop')).color)).toContain(
        'textSecondary',
      );
      // The date sits on the gradient, so it is textSecondary, never textMuted (R12.4).
      expect(tokenNameOf(tokens, styleOf(screen.getByTestId('home-date')).color)).toContain(
        'textSecondary',
      );
      expect(
        tokenNameOf(tokens, styleOf(screen.getByTestId('screen-home')).backgroundColor),
      ).toContain('bgCanvas');
    },
  );

  it('tints each tile\u2019s icon circle by module: Attendance brandSoft, History successSoft, Profile accent, unknown warningSoft (R12.15)', () => {
    const tokens = TOKENS.light;
    renderHome(harness(), { state: { ...ACTIVE, modules: [...ACTIVE.modules, 'PAYSLIPS'] } });
    const circleOf = (testID: string) =>
      tokenNameOf(
        tokens,
        styleOf(screen.getByTestId(testID).firstElementChild as Element).backgroundColor,
      );
    expect(circleOf('home-module-attendance')).toContain('brandSoft');
    expect(circleOf('home-module-history')).toContain('successSoft');
    expect(circleOf('home-module-profile')).toContain('accent');
    expect(circleOf('home-module-update-payslips')).toContain('warningSoft');
  });

  it('draws one tile per server module in server order, Attendance first with today\u2019s line, and opens the module on tap', () => {
    const { onOpenModule } = renderHome(harness());
    const grid = screen.getByTestId('home-grid');
    const tiles = Array.from(grid.querySelectorAll('[data-testid^="home-module-"]')).filter(
      (el) => !el.getAttribute('data-testid')?.endsWith('-status'),
    );
    expect(tiles.map((el) => el.getAttribute('data-testid'))).toEqual([
      'home-module-attendance',
      'home-module-history',
      'home-module-profile',
    ]);
    expect(screen.getByTestId('home-module-attendance-status').textContent).toBe(
      'Checked in 09:12',
    );
    expect(screen.queryByTestId('home-module-history-status')).toBeNull();

    fireEvent.click(screen.getByTestId('home-module-attendance'));
    fireEvent.click(screen.getByTestId('home-module-history'));
    fireEvent.click(screen.getByTestId('home-module-profile'));
    expect(onOpenModule.mock.calls.map(([key]) => key)).toEqual([
      'ATTENDANCE',
      'HISTORY',
      'PROFILE',
    ]);
  });

  it('shows exactly the server list: a shorter list, a different order, no tile the server did not send', () => {
    renderHome(harness(), { state: { ...ACTIVE, modules: ['PROFILE', 'ATTENDANCE'] } });
    const grid = screen.getByTestId('home-grid');
    const tiles = Array.from(grid.querySelectorAll('[data-testid^="home-module-"]')).filter(
      (el) => !el.getAttribute('data-testid')?.endsWith('-status'),
    );
    // The large tile is drawn first whatever its position; the half tiles keep server order.
    expect(tiles.map((el) => el.getAttribute('data-testid'))).toEqual([
      'home-module-attendance',
      'home-module-profile',
    ]);
    expect(screen.queryByTestId('home-module-history')).toBeNull();
  });

  it('a module this version does not know is the update tile: tapping says so and never navigates (R6.6)', () => {
    const { onOpenModule } = renderHome(harness(), {
      state: { ...ACTIVE, modules: ['ATTENDANCE', 'PAYSLIPS'] },
    });
    const tile = screen.getByTestId('home-module-update-payslips');
    expect(screen.queryByTestId('home-module-update-payslips-status')).toBeNull();
    fireEvent.click(tile);
    expect(screen.getByTestId('home-module-update-payslips-status').textContent).toBe(
      STRINGS_EN['module.updateApp'],
    );
    expect(onOpenModule).not.toHaveBeenCalled();
  });

  it('the status line follows `today`: both times, none, or a stale day (R6.5, R6.7)', () => {
    expect(
      todayLine(
        { today: { date: '2025-05-12', in: '09:12', out: '18:05', nextDirection: 'IN' } },
        '2025-05-12',
      ),
    ).toBe('Checked in 09:12 · out 18:05');
    expect(todayLine({ today: undefined }, '2025-05-12')).toBe(STRINGS_EN['home.notCheckedIn']);
    // Stored yesterday, opened today without network: yesterday's times are not today's.
    expect(
      todayLine(
        { today: { date: '2025-05-11', in: '09:12', out: null, nextDirection: 'OUT' } },
        '2025-05-12',
      ),
    ).toBe(STRINGS_EN['home.notCheckedIn']);
  });

  it('offline: works from the stored state and says the server was not reached', () => {
    renderHome(harness(), { offline: true });
    expect(screen.getByTestId('home-offline').textContent).toBe(STRINGS_EN['common.notReachable']);
    expect(screen.getByTestId('home-module-attendance')).toBeTruthy();
  });

  it('a profile-requested banner opens Profile; any other banner re-reads the state (R10.1)', async () => {
    const rows = [
      notification('n1', 'Your shop has asked for your details', 'PROFILE_REQUESTED'),
      notification('n2', 'Sri Ganesh Stores accepted you', 'JOIN_REQUEST_APPROVED'),
    ];
    const h = harness({ unread: rows });
    // The server lists the same two, with their types.
    h.account.notifications.mockResolvedValue({ items: rows, unread: rows.length });
    const { onOpenModule } = renderHome(h);
    fireEvent.click(await screen.findByTestId('home-banners-n1'));
    await waitFor(() => expect(onOpenModule).toHaveBeenCalledWith('PROFILE'));
    expect(h.account.markRead).toHaveBeenCalledWith('n1');
    expect(h.shell.refresh).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByTestId('home-banners-n2'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.markRead).toHaveBeenCalledWith('n2');
    expect(screen.queryByTestId('home-banners-n2')).toBeNull();
  });

  it('has no primary button: the Attendance tile is the primary action (R6.4, R12.5)', () => {
    renderHome(harness());
    expect(screen.queryByTestId('screen-home-footer')).toBeNull();
    expect(screen.getByText(t('module.attendance'))).toBeTruthy();
  });
});

describe('pairs', () => {
  it('groups two to a row and leaves an odd one alone', () => {
    expect(pairs([])).toEqual([]);
    expect(pairs([1])).toEqual([[1]]);
    expect(pairs([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(pairs([1, 2, 3, 4])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});
