import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { STRINGS_EN } from '../i18n';
import { TOKENS } from '../theme';
import { COMPLETE_PROFILE_SECTIONS, CompleteProfileScreen } from './CompleteProfileScreen';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

afterEach(cleanup);

describe('CompleteProfileScreen (R8.6, R8.9)', () => {
  it('lists what may be asked, when, and the rules, in plain words and in that order', () => {
    renderThemed(<CompleteProfileScreen onBack={vi.fn()} />);
    expect(screen.getByTestId('complete-profile-intro').textContent).toBe(
      STRINGS_EN['completeProfile.intro'],
    );
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual([
      STRINGS_EN['completeProfile.title'],
      STRINGS_EN['completeProfile.whatHeading'],
      STRINGS_EN['completeProfile.whenHeading'],
      STRINGS_EN['completeProfile.rulesHeading'],
    ]);
    for (const section of COMPLETE_PROFILE_SECTIONS) {
      for (const item of section.items) {
        expect(screen.getByText(STRINGS_EN[item])).toBeTruthy();
      }
    }
    // The texts say what R8.8 binds the later version to.
    expect(STRINGS_EN['completeProfile.whatAadhaar']).toMatch(/last 4 digits or a Virtual ID/);
    expect(STRINGS_EN['completeProfile.ruleDeleted']).toMatch(/90 days/);
  });

  it('has no input field and exactly one button, Back', () => {
    const onBack = vi.fn();
    renderThemed(<CompleteProfileScreen onBack={onBack} />);
    expect(document.querySelectorAll('input, textarea').length).toBe(0);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([STRINGS_EN['completeProfile.back']]);
    expect(screen.getByTestId('screen-complete-profile-footer').contains(buttons[0])).toBe(true);
    fireEvent.click(screen.getByTestId('complete-profile-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it.each(SCHEMES)(
    'in %s: each item is a 56 dp row with a brand glyph on a brandSoft circle, inside a 20 dp card per section (R12.15)',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(<CompleteProfileScreen onBack={vi.fn()} />, scheme);
      for (const section of COMPLETE_PROFILE_SECTIONS) {
        const card = screen.getByTestId(`complete-profile-${section.heading}-card`);
        expect(tokenNameOf(tokens, styleOf(card).backgroundColor)).toContain('bgElevated');
        expect(radiusNameOf(tokens, styleOf(card).borderRadius)).toContain('card');
        for (const item of section.items) {
          const row = screen.getByTestId(`complete-profile-${item}`);
          expect(card.contains(row)).toBe(true);
          expect(styleOf(row).minHeight).toBe(56);
          expect(row.getAttribute('role')).toBe('text');
          expect(row.getAttribute('aria-label')).toBe(STRINGS_EN[item]);
          const circle = screen.getByTestId(`complete-profile-${item}-icon-circle`);
          expect(styleOf(circle)).toMatchObject({ width: 40, height: 40 });
          expect(tokenNameOf(tokens, styleOf(circle).backgroundColor)).toContain('brandSoft');
          const glyph = screen.getByTestId(`complete-profile-${item}-icon`);
          const part = styleOf(glyph.firstElementChild as Element);
          expect(tokenNameOf(tokens, part.borderColor ?? part.backgroundColor)).toContain('brand');
          expect(screen.queryByTestId(`complete-profile-${item}-chevron`)).toBeNull();
        }
      }
    },
  );
});
