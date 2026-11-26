import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '../app/deps';
import type { ShellActions } from '../app/useAppState';
import { STRINGS_EN } from '../i18n';
import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS, type ColorScheme } from '../theme';
import { OfflineScreen } from './OfflineScreen';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(cleanup);

function harness(scheme: ColorScheme = 'light') {
  const account = { logout: vi.fn(async () => ({ success: true })) };
  const authStore = { clearForLogout: vi.fn(async () => undefined) };
  const deps = { account, authStore } as unknown as AppDeps;
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn(() => false),
    confirm: vi.fn(async () => true),
  };
  renderThemed(<OfflineScreen deps={deps} shell={shell} />, scheme);
  return { account, authStore, shell };
}

describe('OfflineScreen (R6.7)', () => {
  it('says the line, and Retry reads the state again', () => {
    const h = harness();
    expect(screen.getByText(STRINGS_EN['offline.title'])).toBeTruthy();
    expect(screen.getByText(STRINGS_EN['offline.title'])).toBe(
      screen.getByText("Couldn't reach Stockkart. Try again when you have network."),
    );
    fireEvent.click(screen.getByRole('button', { name: STRINGS_EN['offline.retry'] }));
    expect(h.shell.refresh).toHaveBeenCalledTimes(1);
    expect(h.account.logout).not.toHaveBeenCalled();
  });

  it.each(SCHEMES)(
    'in %s: the line is a warning-tinted StatusCard with a warning glyph, Retry the one pill primary button in the footer, Log out in danger (R12.15)',
    (scheme) => {
      const tokens = TOKENS[scheme];
      harness(scheme);
      const card = screen.getByTestId('offline-line');
      expect(tokenNameOf(tokens, styleOf(card).backgroundColor)).toContain('warningSoft');
      expect(radiusNameOf(tokens, styleOf(card).borderRadius)).toContain('card');
      const glyph = styleOf(screen.getByTestId('offline-line-icon').firstElementChild as Element);
      expect(tokenNameOf(tokens, glyph.borderColor ?? glyph.backgroundColor)).toContain('warning');
      expect(tokenNameOf(tokens, styleOf(card.querySelector('span') as Element).color)).toContain(
        'textPrimary',
      );
      const retry = screen.getByTestId('offline-retry');
      expect(screen.getByTestId('screen-offline-footer').contains(retry)).toBe(true);
      expect(tokenNameOf(tokens, styleOf(retry).backgroundColor)).toContain('brand');
      expect(radiusNameOf(tokens, styleOf(retry).borderRadius)).toContain('pill');
      const logOut = screen.getByTestId('offline-log-out');
      expect(tokenNameOf(tokens, styleOf(logOut.querySelector('span') as Element).color)).toContain(
        'danger',
      );
    },
  );

  it('Log out confirms first, then ends the session and re-resolves (R12.5, R9.5)', async () => {
    const h = harness();
    fireEvent.click(screen.getByRole('button', { name: STRINGS_EN['common.logOut'] }));
    expect(h.account.logout).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: STRINGS_EN['common.logOutQuestion'] })).toBeTruthy();
    fireEvent.click(screen.getByTestId('offline-log-out-sheet-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.logout).toHaveBeenCalledTimes(1);
    expect(h.authStore.clearForLogout).toHaveBeenCalledTimes(1);
  });
});
