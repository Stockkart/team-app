import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SERVER_MESSAGES,
  UNPAIR_NEEDS_NETWORK,
  type WorkerProfileResponse,
  type WorkerStateResponse,
} from '@stockkart/attendance-protocol';

import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { inferAccountErrorCode } from '../api/accountClient';
import { NotAuthenticated, NotReachable, ServerRefusal } from '../api/transport';
import type { AppDeps } from '../app/deps';
import type { ShellActions } from '../app/useAppState';
import { STRINGS_EN, t } from '../i18n';
import type { AccountProfile, StoredWorkerState } from '../state/authStore';
import { ThemeProvider, TOKENS, type ColorScheme } from '../theme';
import { PROFILE_AVATAR_SIZE, ProfileScreen } from './ProfileScreen';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(cleanup);

const PROFILE: AccountProfile = {
  userId: 'u1',
  name: 'Priya Sharma',
  email: 'priya@example.in',
  phone: '9876543210',
  photoUrl: '/api/v1/users/u1/photo',
  role: 'WORKER',
};

const ACTIVE: StoredWorkerState = {
  state: 'ACTIVE',
  shop: { shopId: 's1', shopName: 'Sri Ganesh Stores' },
  employee: {
    employeeId: 'e1',
    code: 'EMP-015',
    name: 'Priya Sharma',
    joinDate: '2025-04-03',
    status: 'ACTIVE',
  },
  modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
  pairing: { state: 'PAIRED', pairingId: 'p1' },
  serverTime: '2025-05-12T08:00:00Z',
};

const SERVER_PROFILE: WorkerProfileResponse = {
  name: 'Priya Sharma',
  phone: '9876543210',
  email: 'priya@example.in',
  photoUrl: '/api/v1/users/u1/photo',
  shopName: 'Sri Ganesh Stores',
  employeeCode: 'EMP-015',
  joinDate: '2025-04-03',
  profileRequested: false,
  pairingState: 'PAIRED',
};

const AFTER_LEAVE: WorkerStateResponse = {
  state: 'NO_SHOP',
  account: { userId: 'u1', name: 'Priya Sharma', email: 'priya@example.in', role: 'WORKER' },
  modules: [],
  notifications: { unread: 0, top: [] },
  serverTime: '2025-05-12T08:01:00Z',
};

function harness(options: { paired?: boolean; server?: Partial<WorkerProfileResponse> } = {}) {
  let paired = options.paired ?? true;
  const account = {
    profile: vi.fn(async () => ({ ...SERVER_PROFILE, ...options.server })),
    leaveShop: vi.fn(async () => AFTER_LEAVE),
    logout: vi.fn(async () => ({ success: true })),
    imageSource: vi.fn(async (photoUrl: string) => ({
      uri: `https://api.test.invalid${photoUrl}`,
      headers: { Authorization: 'Bearer tok' },
    })),
  };
  const client = { unpairMe: vi.fn(async () => ({ unpaired: true })) };
  const pairingStore = {
    isPaired: vi.fn(async () => paired),
    wipe: vi.fn(async () => {
      paired = false;
    }),
  };
  const authStore = { clearForLogout: vi.fn(async () => undefined) };
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn((error: unknown) => error instanceof NotAuthenticated),
    confirm: vi.fn(async () => true),
  };
  const deps = {
    account,
    client,
    pairingStore,
    authStore,
    appVersion: '1.2.0 (34)',
  } as unknown as AppDeps;
  return { deps, shell, account, client, pairingStore, authStore };
}

type Harness = ReturnType<typeof harness>;

function element(h: Harness, overrides: Partial<Parameters<typeof ProfileScreen>[0]> = {}) {
  return (
    <ProfileScreen
      deps={h.deps}
      shell={h.shell}
      state={ACTIVE}
      profile={PROFILE}
      onEditDetails={vi.fn()}
      onCompleteProfile={vi.fn()}
      {...overrides}
    />
  );
}

function renderProfile(
  h: Harness,
  overrides: Partial<Parameters<typeof ProfileScreen>[0]> = {},
  scheme: ColorScheme = 'light',
) {
  return renderThemed(element(h, overrides), scheme);
}

/** Every `<button>` of the screen with a `profile-*` test id, top to bottom (radios included). */
function buttonLabels(): string[] {
  return Array.from(document.querySelectorAll('button[data-testid^="profile-"]')).map(
    (b) => b.textContent ?? '',
  );
}

describe('ProfileScreen (R8.1)', () => {
  it('shows the photo, name, phone, e-mail, shop, employee code and join date', async () => {
    const h = harness();
    renderProfile(h);
    expect(screen.getByTestId('profile-name').textContent).toBe('Priya Sharma');
    expect(screen.getByTestId('profile-phone-value').textContent).toBe('9876543210');
    expect(screen.getByTestId('profile-email-value').textContent).toBe('priya@example.in');
    expect(screen.getByTestId('profile-shop-value').textContent).toBe('Sri Ganesh Stores');
    expect(screen.getByTestId('profile-code-value').textContent).toBe('EMP-015');
    expect(screen.getByTestId('profile-join-date-value').textContent).toBe('Thu, 3 Apr 2025');
    await waitFor(() =>
      expect(screen.getByTestId('profile-avatar').getAttribute('src')).toBe(
        'https://api.test.invalid/api/v1/users/u1/photo',
      ),
    );
    expect(screen.getByTestId('profile-avatar').getAttribute('data-headers')).toBe(
      JSON.stringify({ Authorization: 'Bearer tok' }),
    );
    expect(screen.getByTestId('profile-version').textContent).toBe(
      t('profile.appVersion', { version: '1.2.0 (34)' }),
    );
  });

  it('lists the controls in the required order, Edit details as the one primary button', async () => {
    const h = harness();
    renderProfile(h);
    await waitFor(() => expect(screen.getByTestId('profile-remove-phone')).toBeTruthy());
    expect(buttonLabels()).toEqual([
      STRINGS_EN['profile.editDetails'],
      STRINGS_EN['profile.completeProfile'],
      STRINGS_EN['profile.themeSystem'],
      STRINGS_EN['profile.themeLight'],
      STRINGS_EN['profile.themeDark'],
      STRINGS_EN['profile.removePhone'],
      STRINGS_EN['profile.leaveShop'],
      STRINGS_EN['common.logOut'],
    ]);
    // Exactly one filled primary button (R12.5): the three theme choices are radios, the rest
    // secondary or danger text buttons.
    const primary = Array.from(document.querySelectorAll('button'))
      .filter((b) => b.getAttribute('role') !== 'radio')
      .filter(
        (b) =>
          JSON.parse(b.getAttribute('data-style') ?? '{}').backgroundColor ===
          TOKENS.light.color.brand,
      );
    expect(primary.map((b) => b.textContent)).toEqual([STRINGS_EN['profile.editDetails']]);
    expect(screen.queryByTestId('screen-profile-footer')).toBeNull();
  });

  it.each(SCHEMES)(
    'in %s: a header card with the 72 dp avatar on brandSoft, one 20 dp list card of 56 dp rows with chevrons, destructive rows in danger (R12.15)',
    async (scheme) => {
      const tokens = TOKENS[scheme];
      const h = harness({ server: { profileRequested: true } });
      renderProfile(h, { profile: { ...PROFILE, photoUrl: undefined } }, scheme);
      await screen.findByTestId('profile-remove-phone');
      await screen.findByTestId('profile-requested-badge');

      const header = screen.getByTestId('profile-header');
      expect(tokenNameOf(tokens, styleOf(header).backgroundColor)).toContain('bgElevated');
      expect(radiusNameOf(tokens, styleOf(header).borderRadius)).toContain('card');
      const avatar = screen.getByTestId('profile-avatar');
      expect(styleOf(avatar)).toMatchObject({ width: 72, height: 72 });
      expect(PROFILE_AVATAR_SIZE).toBe(72);
      expect(tokenNameOf(tokens, styleOf(avatar).backgroundColor)).toContain('brandSoft');
      expect(tokenNameOf(tokens, styleOf(avatar.querySelector('span') as Element).color)).toContain(
        'brand',
      );

      const list = screen.getByTestId('profile-list');
      expect(tokenNameOf(tokens, styleOf(list).backgroundColor)).toContain('bgElevated');
      expect(radiusNameOf(tokens, styleOf(list).borderRadius)).toContain('card');
      if (scheme === 'dark') {
        expect(tokenNameOf(tokens, styleOf(list).borderColor)).toContain('borderDefault');
        expect(styleOf(list).elevation).toBe(0);
      } else {
        expect(styleOf(list).borderWidth).toBe(0);
        expect(styleOf(list).elevation).toBe(2);
      }
      for (const id of [
        'profile-complete',
        'profile-remove-phone',
        'profile-leave-shop',
        'profile-log-out',
      ]) {
        const row = screen.getByTestId(id);
        expect(list.contains(row)).toBe(true);
        expect(styleOf(row).minHeight).toBe(56);
        expect(screen.getByTestId(`${id}-chevron`)).toBeTruthy();
      }
      expect(
        tokenNameOf(tokens, styleOf(screen.getByTestId('profile-complete-label')).color),
      ).toContain('textPrimary');
      for (const id of ['profile-remove-phone', 'profile-leave-shop', 'profile-log-out']) {
        expect(tokenNameOf(tokens, styleOf(screen.getByTestId(`${id}-label`)).color)).toContain(
          'danger',
        );
      }

      // The badge is a warningSoft Chip with its text in textPrimary and a warning icon.
      const badge = screen.getByTestId('profile-requested-badge');
      expect(tokenNameOf(tokens, styleOf(badge).backgroundColor)).toContain('warningSoft');
      expect(radiusNameOf(tokens, styleOf(badge).borderRadius)).toContain('pill');
      expect(tokenNameOf(tokens, styleOf(badge.querySelector('span') as Element).color)).toContain(
        'textPrimary',
      );
      expect(screen.getByTestId('profile-complete').getAttribute('aria-label')).toBe(
        `${STRINGS_EN['profile.completeProfile']}. ${STRINGS_EN['profile.profileRequestedBadge']}`,
      );

      // The selected theme chip is a brand pill with a textInverse label.
      const system = screen.getByTestId('profile-theme-system');
      expect(tokenNameOf(tokens, styleOf(system).backgroundColor)).toContain('brand');
      expect(radiusNameOf(tokens, styleOf(system).borderRadius)).toContain('pill');
      expect(tokenNameOf(tokens, styleOf(system.querySelector('span') as Element).color)).toContain(
        'textInverse',
      );
      const dark = screen.getByTestId('profile-theme-dark');
      expect(tokenNameOf(tokens, styleOf(dark).borderColor)).toContain('borderStrong');

      // The version line is textMuted on the canvas (never on a tint).
      expect(tokenNameOf(tokens, styleOf(screen.getByTestId('profile-version')).color)).toContain(
        'textMuted',
      );
    },
  );

  it('Edit details and Complete your profile open their screens', async () => {
    const h = harness();
    const onEditDetails = vi.fn();
    const onCompleteProfile = vi.fn();
    renderProfile(h, { onEditDetails, onCompleteProfile });
    fireEvent.click(screen.getByTestId('profile-edit'));
    fireEvent.click(screen.getByTestId('profile-complete'));
    expect(onEditDetails).toHaveBeenCalledTimes(1);
    expect(onCompleteProfile).toHaveBeenCalledTimes(1);
  });

  it('shows the badge on Complete your profile only when the shop asked for details (R8.7)', async () => {
    const h = harness({ server: { profileRequested: true } });
    renderProfile(h);
    expect((await screen.findByTestId('profile-requested-badge')).textContent).toBe(
      STRINGS_EN['profile.profileRequestedBadge'],
    );
    cleanup();

    const quiet = harness();
    renderProfile(quiet);
    await waitFor(() => expect(quiet.account.profile).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByTestId('profile-requested-badge')).toBeNull();
  });

  it('draws what the phone knows when the profile read fails; a 401 goes to the shell (R6.7, R9.3)', async () => {
    const h = harness();
    h.account.profile.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    renderProfile(h);
    await waitFor(() => expect(h.shell.handleError).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('profile-name').textContent).toBe('Priya Sharma');
    expect(screen.getByTestId('profile-shop-value').textContent).toBe('Sri Ganesh Stores');
    cleanup();

    const expired = harness();
    expired.account.profile.mockRejectedValueOnce(new NotAuthenticated('expired'));
    renderProfile(expired);
    await waitFor(() => expect(expired.shell.handleError).toHaveBeenCalledTimes(1));
    expect(expired.shell.handleError).toHaveReturnedWith(true);
  });
});

describe('ProfileScreen — Theme (R12.10)', () => {
  it('marks the current choice and reports a new one so the owner persists it', () => {
    const h = harness();
    const onOverrideChange = vi.fn();
    render(
      <ThemeProvider override="system" onOverrideChange={onOverrideChange}>
        {element(h)}
      </ThemeProvider>,
    );
    expect(screen.getByTestId('profile-theme-system').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('profile-theme-dark').getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByTestId('profile-theme-dark'));
    expect(onOverrideChange).toHaveBeenCalledWith('dark');
    expect(screen.getByTestId('profile-theme-dark').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('profile-theme-system').getAttribute('aria-selected')).toBe('false');
    // The whole screen now draws in the dark canvas.
    expect(
      JSON.parse(screen.getByTestId('screen-profile').getAttribute('data-style') ?? '{}'),
    ).toEqual(expect.objectContaining({ backgroundColor: TOKENS.dark.color.bgCanvas }));
  });
});

describe('ProfileScreen — Remove this phone (R7.7, R7.8)', () => {
  it('is offered only while the phone holds a pairing', async () => {
    const h = harness({ paired: false });
    renderProfile(h);
    await waitFor(() => expect(h.pairingStore.isPaired).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByTestId('profile-remove-phone')).toBeNull();
    expect(screen.getByTestId('profile-leave-shop')).toBeTruthy();
  });

  it('confirms, unpairs on the server, wipes the pairing, keeps the session and re-reads', async () => {
    const h = harness();
    renderProfile(h);
    fireEvent.click(await screen.findByTestId('profile-remove-phone'));
    expect(screen.getByText(STRINGS_EN['profile.removePhoneQuestion'])).toBeTruthy();
    fireEvent.click(screen.getByTestId('profile-remove-phone-sheet-cancel'));
    expect(h.client.unpairMe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('profile-remove-phone'));
    fireEvent.click(screen.getByTestId('profile-remove-phone-sheet-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.client.unpairMe).toHaveBeenCalledTimes(1);
    expect(h.pairingStore.wipe).toHaveBeenCalledTimes(1);
    // The session is kept: nothing of the account set is touched.
    expect(h.account.logout).not.toHaveBeenCalled();
    expect(h.authStore.clearForLogout).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('profile-remove-phone')).toBeNull());
  });

  it('not reachable keeps the pairing and shows the HR text; "not paired" wipes and keeps the session', async () => {
    const h = harness();
    h.client.unpairMe.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    renderProfile(h);
    fireEvent.click(await screen.findByTestId('profile-remove-phone'));
    fireEvent.click(screen.getByTestId('profile-remove-phone-sheet-confirm'));
    expect((await screen.findByTestId('profile-remove-phone-line')).textContent).toBe(
      UNPAIR_NEEDS_NETWORK,
    );
    expect(h.pairingStore.wipe).not.toHaveBeenCalled();
    expect(h.shell.refresh).not.toHaveBeenCalled();

    h.client.unpairMe.mockRejectedValueOnce(
      new ServerRefusal(403, SERVER_MESSAGES.HR_APP_NOT_PAIRED, () => 'HR_APP_NOT_PAIRED'),
    );
    fireEvent.click(screen.getByTestId('profile-remove-phone'));
    fireEvent.click(screen.getByTestId('profile-remove-phone-sheet-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.pairingStore.wipe).toHaveBeenCalledTimes(1);
    expect(h.authStore.clearForLogout).not.toHaveBeenCalled();
  });
});

describe('ProfileScreen — Leave this shop (R5.3, R5.4)', () => {
  it('asks "Leave Sri Ganesh Stores?" with the explanation; Cancel changes nothing', () => {
    const h = harness();
    renderProfile(h);
    fireEvent.click(screen.getByTestId('profile-leave-shop'));
    expect(
      screen.getByText(t('profile.leaveShopQuestion', { shopName: 'Sri Ganesh Stores' })),
    ).toBeTruthy();
    expect(screen.getByText(STRINGS_EN['profile.leaveShopExplanation'])).toBeTruthy();
    fireEvent.click(screen.getByTestId('profile-leave-shop-sheet-cancel'));
    expect(h.account.leaveShop).not.toHaveBeenCalled();
  });

  it('confirming leaves once and routes the shell from the answer', async () => {
    const h = harness();
    renderProfile(h);
    fireEvent.click(screen.getByTestId('profile-leave-shop'));
    fireEvent.click(screen.getByTestId('profile-leave-shop-sheet-confirm'));
    await waitFor(() => expect(h.shell.apply).toHaveBeenCalledTimes(1));
    expect(h.account.leaveShop).toHaveBeenCalledTimes(1);
    expect(h.shell.apply).toHaveBeenCalledWith(AFTER_LEAVE);
    expect(h.pairingStore.wipe).not.toHaveBeenCalled();
    expect(h.authStore.clearForLogout).not.toHaveBeenCalled();
  });

  it('not reachable shows the line and changes nothing; a refusal is shown word for word', async () => {
    const h = harness();
    h.account.leaveShop.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    renderProfile(h);
    fireEvent.click(screen.getByTestId('profile-leave-shop'));
    fireEvent.click(screen.getByTestId('profile-leave-shop-sheet-confirm'));
    expect((await screen.findByTestId('profile-leave-shop-line')).textContent).toBe(
      STRINGS_EN['common.notReachable'],
    );
    expect(h.shell.apply).not.toHaveBeenCalled();
    expect(h.shell.refresh).not.toHaveBeenCalled();

    h.account.leaveShop.mockRejectedValueOnce(
      new ServerRefusal(409, 'You are not part of a shop.', inferAccountErrorCode),
    );
    fireEvent.click(screen.getByTestId('profile-leave-shop'));
    fireEvent.click(screen.getByTestId('profile-leave-shop-sheet-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('profile-leave-shop-line').textContent).toBe(
        'You are not part of a shop.',
      ),
    );
  });
});

describe('ProfileScreen — Log out (R8.5, R9.5)', () => {
  it('confirms, ends the session on the server, clears the account set, keeps the pairing, re-reads', async () => {
    const h = harness();
    renderProfile(h);
    fireEvent.click(screen.getByTestId('profile-log-out'));
    expect(screen.getByText(STRINGS_EN['common.logOutQuestion'])).toBeTruthy();
    fireEvent.click(screen.getByTestId('profile-log-out-sheet-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.logout).toHaveBeenCalledTimes(1);
    expect(h.authStore.clearForLogout).toHaveBeenCalledTimes(1);
    expect(h.pairingStore.wipe).not.toHaveBeenCalled();
    expect(h.client.unpairMe).not.toHaveBeenCalled();
  });
});
