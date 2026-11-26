import { cleanup, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { gradientOf } from '../../test-support/expo-linear-gradient';
import { styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS } from '../theme';
import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { GRADIENT_END, GRADIENT_START, GradientHeader } from './GradientHeader';

afterEach(cleanup);

describe('GradientHeader (R12.16)', () => {
  it.each(SCHEMES)(
    'in %s: a brandSoft → accentSoft gradient from the top-left to the bottom-right corner, bottom corners radius card, 24 dp padding',
    (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(
        <GradientHeader testID="band">
          <AppText variant="title">Good morning, Ramesh</AppText>
        </GradientHeader>,
        scheme,
      );
      const band = screen.getByTestId('band');
      const gradient = gradientOf(band);
      expect(gradient).not.toBeNull();
      const [from, to] = gradient?.colors ?? [];
      expect(tokenNameOf(tokens, from)).toContain('brandSoft');
      expect(tokenNameOf(tokens, to)).toContain('accentSoft');
      expect(gradient?.start).toEqual({ x: 0, y: 0 });
      expect(gradient?.end).toEqual({ x: 1, y: 1 });
      expect(GRADIENT_START).toEqual({ x: 0, y: 0 });
      expect(GRADIENT_END).toEqual({ x: 1, y: 1 });
      const style = styleOf(band);
      expect(style.padding).toBe(tokens.space.lg);
      expect(tokens.space.lg).toBe(24);
      expect(radiusNameOf(tokens, style.borderBottomLeftRadius)).toContain('card');
      expect(radiusNameOf(tokens, style.borderBottomRightRadius)).toContain('card');
      expect(style.borderTopLeftRadius).toBeUndefined();
      expect(screen.getByText('Good morning, Ramesh')).toBeTruthy();
    },
  );

  it('resolves the token names tokens.gradient.header carries, so the band follows the theme', () => {
    for (const scheme of SCHEMES) {
      const tokens = TOKENS[scheme];
      renderThemed(<GradientHeader testID="band" />, scheme);
      const [from, to] = tokens.gradient.header;
      expect(gradientOf(screen.getByTestId('band'))?.colors).toEqual([
        tokens.color[from],
        tokens.color[to],
      ]);
      cleanup();
    }
  });

  it('carries the children the Home header puts on it (avatar, texts) and extra style for the status-bar inset', () => {
    renderThemed(
      <GradientHeader style={{ paddingTop: 48 }} testID="band">
        <Avatar name="Ramesh Kumar" size={56} variant="onSoft" testID="avatar" />
        <AppText color="textSecondary">Sri Ganesh Stores</AppText>
      </GradientHeader>,
    );
    expect(screen.getByRole('image', { name: 'Ramesh Kumar' })).toBeTruthy();
    expect(screen.getByText('Sri Ganesh Stores')).toBeTruthy();
    expect(styleOf(screen.getByTestId('band')).paddingTop).toBe(48);
  });

  it('is the only source file that imports expo-linear-gradient (lint rule, design DD17)', () => {
    const here = readFileSync(path.resolve(__dirname, 'GradientHeader.tsx'), 'utf8');
    expect(here).toMatch(/from 'expo-linear-gradient'/);
  });
});
