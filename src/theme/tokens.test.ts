/**
 * Token-set completeness (R12.1, R12.13, R12.15; design DD15): both themes have exactly the keys
 * the design "Colour tokens" table and `tokens.ts` block name (colour, space, radius, shadow,
 * gradient), every colour is an opaque `#RRGGBB`, `gradient.header` names existing colour keys,
 * and spacing / radii are the same in both themes. The app owns its palette (D14): nothing here
 * reads a file outside this repository.
 */
import { describe, expect, it } from 'vitest';

import { dark, light, TOKENS, type ColorToken, type ThemeTokens } from './tokens';

/** The colour keys of the design table, in its order. */
const COLOR_KEYS: readonly ColorToken[] = [
  'brand',
  'brandSoft',
  'accent',
  'accentSoft',
  'accentText',
  'textOnAccent',
  'success',
  'successSoft',
  'warning',
  'warningSoft',
  'danger',
  'dangerSoft',
  'bgCanvas',
  'bgSurface',
  'bgElevated',
  'bgMuted',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'textInverse',
  'borderDefault',
  'borderStrong',
];

const SPACE_KEYS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
const RADIUS_KEYS = ['sm', 'md', 'lg', 'xl', 'full', 'field', 'card', 'pill'];
const SHADOW_KEYS = ['card'];
const GRADIENT_KEYS = ['header'];

const HEX6 = /^#[0-9A-F]{6}$/;

const sorted = (keys: readonly string[]) => [...keys].sort();

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme has the complete token set (R12.1, R12.13)', (_name, theme) => {
  it('has exactly the design colour keys', () => {
    expect(sorted(Object.keys(theme.color))).toEqual(sorted(COLOR_KEYS));
    expect(COLOR_KEYS).toHaveLength(22);
  });

  it('every colour is an opaque #RRGGBB (the soft tints are no longer rgba)', () => {
    for (const key of COLOR_KEYS) {
      expect(theme.color[key], key).toMatch(HEX6);
    }
  });

  it('has the space, radius, shadow and gradient groups with exactly the design keys', () => {
    expect(sorted(Object.keys(theme.space))).toEqual(sorted(SPACE_KEYS));
    expect(sorted(Object.keys(theme.radius))).toEqual(sorted(RADIUS_KEYS));
    expect(sorted(Object.keys(theme.shadow))).toEqual(sorted(SHADOW_KEYS));
    expect(sorted(Object.keys(theme.gradient))).toEqual(sorted(GRADIENT_KEYS));
  });

  it('gradient.header names two existing colour keys, brandSoft → accentSoft', () => {
    const [start, end] = theme.gradient.header;
    expect(theme.gradient.header).toHaveLength(2);
    expect(COLOR_KEYS).toContain(start);
    expect(COLOR_KEYS).toContain(end);
    expect(theme.gradient.header).toEqual(['brandSoft', 'accentSoft']);
  });

  it('shadow.card has the React Native shadow shape with a hex shadowColor', () => {
    const card = theme.shadow.card;
    expect(card.shadowColor).toMatch(HEX6);
    expect(typeof card.shadowOpacity).toBe('number');
    expect(typeof card.shadowRadius).toBe('number');
    expect(typeof card.elevation).toBe('number');
    expect(card.shadowOffset).toEqual({
      width: expect.any(Number) as number,
      height: expect.any(Number) as number,
    });
  });
});

describe('values the design fixes (R12.1, R12.13, R12.15)', () => {
  it('spacing and radii do not change between themes', () => {
    expect(dark.space).toEqual(light.space);
    expect(dark.radius).toEqual(light.radius);
    expect(dark.gradient).toEqual(light.gradient);
  });

  it('new radii: field 12, card 20, pill 999; the old keys are kept', () => {
    expect(light.radius).toMatchObject({ field: 12, card: 20, pill: 999 });
    expect(light.radius).toMatchObject({ sm: 4, md: 8, lg: 12, xl: 14, full: 9999 });
  });

  it('light cards have elevation 2 / 8 % 12 dp; dark cards no shadow', () => {
    expect(light.shadow.card).toMatchObject({
      elevation: 2,
      shadowOpacity: 0.08,
      shadowRadius: 12,
    });
    expect(dark.shadow.card).toMatchObject({ elevation: 0, shadowOpacity: 0, shadowRadius: 0 });
  });

  it('the three adjusted light values are the ones the design records', () => {
    expect(light.color.success).toBe('#047854');
    expect(light.color.danger).toBe('#CF1B42');
    expect(light.color.textMuted).toBe('#706A8C');
    expect(light.color.borderStrong).toBe('#8B86A3');
  });

  it('peach is the same fill in both themes; the dark set is the R12.13 one', () => {
    expect(light.color.accent).toBe('#FDBA74');
    expect(dark.color.accent).toBe('#FDBA74');
    expect(dark.color).toMatchObject({
      brand: '#A78BFA',
      brandSoft: '#2E2650',
      bgCanvas: '#120F1F',
      textPrimary: '#F3F0FF',
      textInverse: '#120F1F',
    });
  });

  it('TOKENS maps each scheme to its theme and nothing else', () => {
    const tokens: Record<string, ThemeTokens> = TOKENS;
    expect(Object.keys(tokens).sort()).toEqual(['dark', 'light']);
    expect(TOKENS.light).toBe(light);
    expect(TOKENS.dark).toBe(dark);
  });
});
