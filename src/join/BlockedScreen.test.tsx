import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { harness, type Harness } from '../../test-support/join-harness';
import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import type { BlockedKind } from '../app/AppStateMachine';
import { STRINGS_EN } from '../i18n';
import { TOKENS, type ColorScheme } from '../theme';
import { BlockedScreen, blockedSentence } from './BlockedScreen';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(cleanup);

function renderBlocked(h: Harness, kind: BlockedKind, scheme: ColorScheme = 'light') {
  return renderThemed(<BlockedScreen deps={h.deps} shell={h.shell} kind={kind} />, scheme);
}

describe('BlockedScreen (R5.6)', () => {
  it('a staff account without an employee: the R5.6 sentence and Log out only', () => {
    const h = harness();
    renderBlocked(h, 'staff_no_employee');
    expect(screen.getByTestId('blocked-sentence').textContent).toBe(
      STRINGS_EN['blocked.staffNoEmployee'],
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      STRINGS_EN['common.logOut'],
    ]);
    // No primary action (R6.2): the footer slot stays empty.
    expect(screen.queryByTestId('screen-blocked-footer')).toBeNull();
  });

  it.each(SCHEMES)(
    'in %s: the sentence sits on a neutral 20 dp StatusCard (bgElevated, brand glyph on brandSoft), Log out in danger (R12.15)',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderBlocked(harness(), 'staff_no_employee', scheme);
      const card = screen.getByTestId('blocked-sentence');
      expect(tokenNameOf(tokens, styleOf(card).backgroundColor)).toContain('bgElevated');
      expect(radiusNameOf(tokens, styleOf(card).borderRadius)).toContain('card');
      expect(
        tokenNameOf(
          tokens,
          styleOf(screen.getByTestId('blocked-sentence-icon-circle')).backgroundColor,
        ),
      ).toContain('brandSoft');
      expect(tokenNameOf(tokens, styleOf(card.querySelector('span') as Element).color)).toContain(
        'textPrimary',
      );
      expect(
        tokenNameOf(
          tokens,
          styleOf(screen.getByTestId('blocked-log-out').querySelector('span') as Element).color,
        ),
      ).toContain('danger');
    },
  );

  it('Log out confirms, ends the session on the server, clears the account set and re-reads', async () => {
    const h = harness();
    renderBlocked(h, 'staff_no_employee');
    fireEvent.click(screen.getByTestId('blocked-log-out'));
    fireEvent.click(screen.getByTestId('blocked-log-out-sheet-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.logout).toHaveBeenCalledTimes(1);
    expect(h.authStore.clearForLogout).toHaveBeenCalledTimes(1);
  });

  it('blockedSentence maps each kind to its text', () => {
    expect(blockedSentence('staff_no_employee')).toBe(STRINGS_EN['blocked.staffNoEmployee']);
  });
});
