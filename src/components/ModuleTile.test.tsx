import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS } from '../theme';
import {
  MIN_TOUCH,
  TILE_HALF_SIZE,
  TILE_ICON_CIRCLE,
  TILE_ICON_SIZE,
  TILE_LARGE_HEIGHT,
} from './layout';
import { ModuleTile, moduleTileLabel, UPDATE_APP_TEXT } from './ModuleTile';

afterEach(cleanup);

/** The 48 dp icon circle is the tile's first child; the glyph sits inside it. */
function iconCircle(tile: Element): Element {
  return tile.firstElementChild as Element;
}

function glyphPaint(circle: Element): unknown {
  const glyph = circle.firstElementChild as Element;
  const stroke = styleOf(glyph.firstElementChild as Element);
  return stroke.borderColor ?? stroke.backgroundColor;
}

describe('ModuleTile (R6.4–R6.6, R12.3, R12.9, R12.15)', () => {
  it.each(SCHEMES)(
    'in %s: a large tile is a full-width 96 dp card announcing label and status',
    (scheme) => {
      const tokens = TOKENS[scheme];
      const onPress = vi.fn();
      renderThemed(
        <ModuleTile
          icon="fingerprint"
          label="Attendance"
          statusLine="Checked in 09:12"
          size="large"
          onPress={onPress}
          testID="tile"
        />,
        scheme,
      );
      const tile = screen.getByRole('button', { name: 'Attendance. Checked in 09:12' });
      const style = styleOf(tile);
      expect(style.width).toBe('100%');
      expect(style.minHeight).toBe(TILE_LARGE_HEIGHT);
      expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
      expect(tokenNameOf(tokens, style.backgroundColor)).toContain('bgElevated');
      expect(radiusNameOf(tokens, style.borderRadius)).toContain('card');
      expect(tokenNameOf(tokens, styleOf(screen.getByText('Attendance')).color)).toContain(
        'textPrimary',
      );
      const status = screen.getByTestId('tile-status');
      expect(status.textContent).toBe('Checked in 09:12');
      expect(tokenNameOf(tokens, styleOf(status).color)).toContain('textSecondary');
      fireEvent.click(tile);
      expect(onPress).toHaveBeenCalledTimes(1);
    },
  );

  it('light: shadow.card and no border; dark: no shadow and a 1 dp borderDefault edge', () => {
    renderThemed(
      <ModuleTile icon="history" label="History" size="half" onPress={() => undefined} />,
      'light',
    );
    const light = styleOf(screen.getByRole('button', { name: 'History' }));
    expect(light).toMatchObject(TOKENS.light.shadow.card);
    expect(light.elevation).toBe(2);
    expect(light.borderWidth).toBe(0);
    cleanup();

    renderThemed(
      <ModuleTile icon="history" label="History" size="half" onPress={() => undefined} />,
      'dark',
    );
    const dark = styleOf(screen.getByRole('button', { name: 'History' }));
    expect(dark.elevation).toBe(0);
    expect(dark.shadowOpacity).toBe(0);
    expect(dark.borderWidth).toBe(1);
    expect(tokenNameOf(TOKENS.dark, dark.borderColor)).toContain('borderDefault');
  });

  it.each([
    ['brandSoft', 'brand'],
    ['successSoft', 'success'],
    ['accent', 'textOnAccent'],
    ['warningSoft', 'warning'],
  ] as const)(
    'a 48 dp icon circle tinted %s carries the glyph in %s (both themes)',
    (tint, iconColor) => {
      for (const scheme of SCHEMES) {
        const tokens = TOKENS[scheme];
        renderThemed(
          <ModuleTile
            icon="person"
            label="Profile"
            size="half"
            tint={tint}
            onPress={() => undefined}
          />,
          scheme,
        );
        const circle = iconCircle(screen.getByRole('button', { name: 'Profile' }));
        expect(styleOf(circle)).toMatchObject({
          width: TILE_ICON_CIRCLE,
          height: TILE_ICON_CIRCLE,
          borderRadius: TILE_ICON_CIRCLE / 2,
        });
        expect(tokenNameOf(tokens, styleOf(circle).backgroundColor)).toContain(tint);
        expect(styleOf(circle.firstElementChild as Element)).toMatchObject({
          width: TILE_ICON_SIZE,
          height: TILE_ICON_SIZE,
        });
        expect(tokenNameOf(tokens, glyphPaint(circle))).toContain(iconColor);
        cleanup();
      }
    },
  );

  it('tints brandSoft by default', () => {
    renderThemed(
      <ModuleTile icon="fingerprint" label="Attendance" size="half" onPress={() => undefined} />,
    );
    const circle = iconCircle(screen.getByRole('button', { name: 'Attendance' }));
    expect(tokenNameOf(TOKENS.light, styleOf(circle).backgroundColor)).toContain('brandSoft');
    expect(tokenNameOf(TOKENS.light, glyphPaint(circle))).toContain('brand');
  });

  it('a half tile is a 112 dp square and announces the label alone without a status line', () => {
    renderThemed(
      <ModuleTile icon="history" label="History" size="half" onPress={() => undefined} />,
    );
    const tile = screen.getByRole('button', { name: 'History' });
    expect(styleOf(tile).minHeight).toBe(TILE_HALF_SIZE);
    expect(styleOf(tile).flex).toBe(1);
  });

  it('the unknown variant draws the warningSoft circle whatever tint is asked, shows "Update the app to use this." in warning on press and still reports the tap', () => {
    const onPress = vi.fn();
    renderThemed(
      <ModuleTile
        icon="unknown"
        label="PAYSLIPS"
        size="half"
        variant="unknown"
        tint="brandSoft"
        onPress={onPress}
        testID="u"
      />,
    );
    const tile = screen.getByRole('button', { name: 'PAYSLIPS' });
    const circle = iconCircle(tile);
    expect(tokenNameOf(TOKENS.light, styleOf(circle).backgroundColor)).toContain('warningSoft');
    expect(tokenNameOf(TOKENS.light, glyphPaint(circle))).toContain('warning');
    expect(screen.queryByText(UPDATE_APP_TEXT)).toBeNull();
    fireEvent.click(tile);
    const status = screen.getByTestId('u-status');
    expect(status.textContent).toBe('Update the app to use this.');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(tokenNameOf(TOKENS.light, styleOf(status).color)).toContain('warning');
    expect(screen.getByRole('button', { name: `PAYSLIPS. ${UPDATE_APP_TEXT}` })).toBeTruthy();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('moduleTileLabel joins label and status with a full stop', () => {
    expect(moduleTileLabel('Attendance')).toBe('Attendance');
    expect(moduleTileLabel('Attendance', 'Not checked in')).toBe('Attendance. Not checked in');
  });
});
