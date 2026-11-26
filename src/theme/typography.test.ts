import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FONT_ASSETS, fontFamily, TEXT_SCALING, typeScale, type TypeRoleName } from './typography';

const FONTS_DIR = path.resolve(__dirname, '../../assets/fonts');

describe('type roles (R12.2)', () => {
  it.each([
    ['display', 40],
    ['title', 24],
    ['heading', 20],
    ['buttonPrimary', 18],
    ['body', 16],
    ['secondary', 14],
  ] as const satisfies readonly (readonly [TypeRoleName, number])[])(
    '%s is %d sp',
    (role, size) => {
      expect(typeScale[role].fontSize).toBe(size);
    },
  );

  it('has exactly the six roles', () => {
    expect(Object.keys(typeScale).sort()).toEqual(
      ['body', 'buttonPrimary', 'display', 'heading', 'secondary', 'title'].sort(),
    );
  });

  it.each([
    ['body text', 'body', 16],
    ['secondary text', 'secondary', 14],
    ['primary button label', 'buttonPrimary', 18],
    ['module tile label (AppText default = body)', 'body', 16],
    ['punch time on the Attendance confirmation', 'display', 40],
  ] as const satisfies readonly (readonly [string, TypeRoleName, number])[])(
    'R12.2 minimum: %s (%s) ≥ %d sp',
    (_use, role, minimum) => {
      expect(typeScale[role].fontSize).toBeGreaterThanOrEqual(minimum);
    },
  );

  it('orders the scale so a larger role never reads smaller than the one below it', () => {
    const sizes = (
      ['display', 'title', 'heading', 'buttonPrimary', 'body', 'secondary'] as const
    ).map((role) => typeScale[role].fontSize);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i - 1]).toBeGreaterThan(sizes[i]);
    }
  });

  it('gives every role a bundled family and a line height above its size', () => {
    const families = Object.values(fontFamily) as string[];
    for (const role of Object.values(typeScale)) {
      expect(families).toContain(role.fontFamily);
      expect(role.lineHeight).toBeGreaterThan(role.fontSize);
    }
  });

  it('uses weights, not sizes, to tell the display, titles and buttons from body copy', () => {
    expect(typeScale.display.fontFamily).toBe(fontFamily.bold);
    expect(typeScale.title.fontFamily).toBe(fontFamily.semiBold);
    expect(typeScale.heading.fontFamily).toBe(fontFamily.semiBold);
    expect(typeScale.buttonPrimary.fontFamily).toBe(fontFamily.semiBold);
    expect(typeScale.body.fontFamily).toBe(fontFamily.regular);
    expect(typeScale.secondary.fontFamily).toBe(fontFamily.regular);
  });
});

describe('font scaling (R12.2)', () => {
  it('follows the phone setting up to 200 %', () => {
    expect(TEXT_SCALING).toEqual({ allowFontScaling: true, maxFontSizeMultiplier: 2 });
  });
});

describe('bundled typeface', () => {
  it('registers the four Plus Jakarta Sans weights by family name', () => {
    expect(Object.keys(FONT_ASSETS).sort()).toEqual(
      [
        'PlusJakartaSans-Regular',
        'PlusJakartaSans-Medium',
        'PlusJakartaSans-SemiBold',
        'PlusJakartaSans-Bold',
      ].sort(),
    );
    expect(Object.values(fontFamily).sort()).toEqual(Object.keys(FONT_ASSETS).sort());
  });

  it.each(['Regular', 'Medium', 'SemiBold', 'Bold'])(
    'ships PlusJakartaSans-%s.ttf next to its OFL licence',
    (weight) => {
      expect(existsSync(path.join(FONTS_DIR, `PlusJakartaSans-${weight}.ttf`))).toBe(true);
      expect(existsSync(path.join(FONTS_DIR, 'OFL.txt'))).toBe(true);
    },
  );
});
