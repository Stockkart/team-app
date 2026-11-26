import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS, typeScale } from '../theme';
import { Chip } from './Chip';
import { CHIP_HEIGHT, CHIP_ICON_SIZE } from './layout';

afterEach(cleanup);

/** The colour the chip's glyph is painted in (its first stroke). */
function iconPaint(chip: Element): unknown {
  const icon = screen.getByTestId(`${chip.getAttribute('data-testid')}-icon`);
  const stroke = styleOf(icon.firstElementChild as Element);
  return stroke.borderColor ?? stroke.backgroundColor;
}

describe('Chip (R12.14, R12.15)', () => {
  it.each(SCHEMES)(
    'in %s: a 32 dp pill, secondary text in textPrimary, read-only text to TalkBack',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(<Chip label="Inside shop" testID="chip" />, scheme);
      const chip = screen.getByRole('text', { name: 'Inside shop' });
      const style = styleOf(chip);
      expect(style.minHeight).toBe(CHIP_HEIGHT);
      expect(radiusNameOf(tokens, style.borderRadius)).toContain('pill');
      expect(chip.tagName).toBe('DIV');
      expect(chip.querySelector('button')).toBeNull();
      const label = styleOf(screen.getByText('Inside shop'));
      expect(label.fontSize).toBe(typeScale.secondary.fontSize);
      expect(tokenNameOf(tokens, label.color)).toContain('textPrimary');
      expect(screen.queryByTestId('chip-icon')).toBeNull();
    },
  );

  it.each([
    ['neutral', 'bgSurface', 'textSecondary'],
    ['success', 'successSoft', 'success'],
    ['warning', 'warningSoft', 'warning'],
    ['danger', 'dangerSoft', 'danger'],
    ['accent', 'accentSoft', 'accentText'],
  ] as const)(
    'filled tone %s: background %s, 16 dp leading icon in %s, label still textPrimary (both themes)',
    (tone, tint, iconColor) => {
      for (const scheme of SCHEMES) {
        const tokens = TOKENS[scheme];
        renderThemed(
          <Chip label="Fingerprint ready" icon="check" tone={tone} testID="chip" />,
          scheme,
        );
        const chip = screen.getByTestId('chip');
        expect(tokenNameOf(tokens, styleOf(chip).backgroundColor)).toContain(tint);
        expect(styleOf(chip).borderWidth).toBeUndefined();
        const icon = screen.getByTestId('chip-icon');
        expect(styleOf(icon)).toMatchObject({ width: CHIP_ICON_SIZE, height: CHIP_ICON_SIZE });
        expect(icon.getAttribute('aria-label')).toBeNull();
        expect(tokenNameOf(tokens, iconPaint(chip))).toContain(iconColor);
        expect(tokenNameOf(tokens, styleOf(screen.getByText('Fingerprint ready')).color)).toContain(
          'textPrimary',
        );
        cleanup();
      }
    },
  );

  it.each(SCHEMES)(
    'in %s: outlined is a 1 dp borderStrong outline on bgElevated, icon still in the tone colour',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(
        <Chip label="Location off" icon="warning" tone="warning" outlined testID="chip" />,
        scheme,
      );
      const chip = screen.getByTestId('chip');
      expect(styleOf(chip).borderWidth).toBe(1);
      expect(tokenNameOf(tokens, styleOf(chip).borderColor)).toContain('borderStrong');
      expect(tokenNameOf(tokens, styleOf(chip).backgroundColor)).toContain('bgElevated');
      expect(tokenNameOf(tokens, iconPaint(chip))).toContain('warning');
    },
  );

  it('peach is a fill only: the accent chip never paints accent on its text or icon (R12.14)', () => {
    renderThemed(<Chip label="Profile" icon="person" tone="accent" testID="chip" />);
    const chip = screen.getByTestId('chip');
    expect(tokenNameOf(TOKENS.light, styleOf(screen.getByText('Profile')).color)).not.toContain(
      'accent',
    );
    expect(tokenNameOf(TOKENS.light, iconPaint(chip))).toContain('accentText');
  });

  it('takes a separate TalkBack label', () => {
    renderThemed(<Chip label="09:12" accessibilityLabel="Checked in at 9:12" />);
    expect(screen.getByRole('text', { name: 'Checked in at 9:12' })).toBeTruthy();
  });
});
