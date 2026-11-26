/**
 * The contrast gate (R12.4, D14): every (foreground, surface) pair the component kit and the
 * screens draw meets WCAG 2.x in both themes — 4.5:1 for text under 24 sp regular / 18.67 px
 * semibold, 3:1 for larger text, icons, chips' leading icons and control outlines. `REQUIRED` is
 * the design's "Contrast pairs" table, pair for pair, with its threshold; there is no exception
 * list and no skipped entry. A scan of every `.tsx` under `src/` fails the suite when a component
 * or screen draws a colour token that no pair measures.
 *
 * The tints are opaque hex now, so no compositing is needed; the `rgba(` branch of `parse` and
 * `over` are kept so a stray translucent token would still parse and be measured over its surface
 * instead of crashing the gate.
 *
 * `borderDefault` is the one token the scan does not demand a pair for: it draws decorative card
 * edges (dark theme) and dividers, which R12.4 exempts; it is never a control outline (fields and
 * secondary buttons use `borderStrong`, which is measured).
 */
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { light, TOKENS, type ColorToken, type ThemeTokens } from './tokens';

type Rgb = readonly [number, number, number];

function parse(value: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/i.exec(value);
  if (rgba) {
    return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  }
  throw new Error(`not a colour literal: ${value}`);
}

/** Source-over compositing of a translucent colour on an opaque surface. */
function over(tint: string, surface: Rgb): Rgb {
  const { rgb, alpha } = parse(tint);
  return [0, 1, 2].map((i) =>
    Math.round(rgb[i] * alpha + surface[i] * (1 - alpha)),
  ) as unknown as Rgb;
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio, ≥ 1. */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT = 4.5;
const LARGE_OR_GRAPHIC = 3;

interface Pair {
  /** What draws it (the design table's "Drawn by" column). */
  where: string;
  fg: ColorToken;
  bg: ColorToken;
  min: number;
}

const pair = (fg: ColorToken, bg: ColorToken, min: number, where: string): Pair => ({
  where,
  fg,
  bg,
  min,
});

/** The design's "Contrast pairs" table: every pair the kit draws, each with its threshold. */
const REQUIRED: readonly Pair[] = [
  // textPrimary
  pair('textPrimary', 'bgCanvas', TEXT, 'body text on Screen, TextButton'),
  pair('textPrimary', 'bgSurface', TEXT, 'list rows, chip default'),
  pair(
    'textPrimary',
    'bgElevated',
    TEXT,
    'card titles, field input, sheet question, SecondaryButton label',
  ),
  pair('textPrimary', 'bgMuted', TEXT, 'Banner text, disabled fill label'),
  pair('textPrimary', 'brandSoft', TEXT, 'GradientHeader greeting (start), tinted rows'),
  pair('textPrimary', 'accentSoft', TEXT, 'GradientHeader greeting (end), peach chip label'),
  pair('textPrimary', 'successSoft', TEXT, 'success StatusCard title, success chip label'),
  pair('textPrimary', 'warningSoft', TEXT, 'warning StatusCard title, warning chip label'),
  pair('textPrimary', 'dangerSoft', TEXT, 'danger StatusCard (refusal) title, danger chip label'),
  // textSecondary
  pair('textSecondary', 'bgCanvas', TEXT, 'EmptyState, field label / helper, "and N more"'),
  pair('textSecondary', 'bgSurface', TEXT, 'list row lines'),
  pair('textSecondary', 'bgElevated', TEXT, 'card lines, ModuleTile status, sheet explanation'),
  pair('textSecondary', 'bgMuted', TEXT, 'Banner second line, disabled PunchButton label'),
  pair('textSecondary', 'brandSoft', TEXT, 'GradientHeader shop name and date (start)'),
  pair('textSecondary', 'accentSoft', TEXT, 'GradientHeader shop name and date (end)'),
  pair('textSecondary', 'successSoft', TEXT, 'success card line'),
  pair('textSecondary', 'warningSoft', TEXT, 'warning card line'),
  pair('textSecondary', 'dangerSoft', TEXT, 'danger card line'),
  // textMuted: on the three plain surfaces only, never on a tint
  pair('textMuted', 'bgCanvas', TEXT, 'Home date, app version (14 sp)'),
  pair('textMuted', 'bgSurface', TEXT, 'list tertiary text'),
  pair('textMuted', 'bgElevated', TEXT, 'FormField placeholder'),
  // labels on fills
  pair('textInverse', 'brand', TEXT, 'PrimaryButton label, Avatar initial, selected theme chip'),
  pair('textInverse', 'success', TEXT, 'PunchButton "Check in" label (24 sp, held to 4.5 anyway)'),
  pair(
    'textInverse',
    'danger',
    TEXT,
    'PunchButton "Check out" label, DangerButton filled variant in ConfirmSheet',
  ),
  pair('textOnAccent', 'accent', TEXT, 'Profile tile icon, text on a peach chip'),
  // accent text (peach-coloured text, R12.14)
  pair('accentText', 'bgCanvas', TEXT, 'peach-coloured text on Screen'),
  pair('accentText', 'bgElevated', TEXT, 'peach-coloured text on a card'),
  pair('accentText', 'accentSoft', LARGE_OR_GRAPHIC, 'peach chip leading icon'),
  // tone-coloured text on plain surfaces
  pair('success', 'bgCanvas', TEXT, '"In since" accent word, success text'),
  pair('success', 'bgElevated', TEXT, 'IN time icon + text in History / TodayCard'),
  pair('danger', 'bgCanvas', TEXT, 'DangerButton text, error lines'),
  pair('danger', 'bgElevated', TEXT, 'FormField error line, OUT text in History / TodayCard'),
  pair('warning', 'bgCanvas', TEXT, 'offline line, profile-requested badge text'),
  pair('warning', 'bgElevated', TEXT, 'ModuleTile "Update the app" line'),
  // icons and graphics (3:1)
  pair('brand', 'bgCanvas', LARGE_OR_GRAPHIC, 'links, ActivityIndicator, focus ring'),
  pair('brand', 'bgElevated', LARGE_OR_GRAPHIC, 'brand icons on cards'),
  pair(
    'brand',
    'brandSoft',
    LARGE_OR_GRAPHIC,
    'Attendance tile icon, Join result store icon, Profile avatar disc icon',
  ),
  pair(
    'success',
    'successSoft',
    LARGE_OR_GRAPHIC,
    'History tile icon, success card and chip leading icon',
  ),
  pair(
    'warning',
    'warningSoft',
    LARGE_OR_GRAPHIC,
    'Waiting hourglass, unknown-module icon, warning card and chip leading icon',
  ),
  pair(
    'danger',
    'dangerSoft',
    LARGE_OR_GRAPHIC,
    'danger card and chip leading icon (4.498 in light: an icon pair, never text)',
  ),
  // control outlines (3:1)
  pair('borderStrong', 'bgCanvas', LARGE_OR_GRAPHIC, 'SecondaryButton outline on Screen'),
  pair('borderStrong', 'bgElevated', LARGE_OR_GRAPHIC, 'FormField and Chip outline on a card'),
  pair('danger', 'bgElevated', LARGE_OR_GRAPHIC, 'FormField error outline'),
];

/**
 * Tokens the scan does not demand a pair for (R12.4: "decorative card edges and dividers drawn
 * with the border token are not control outlines and are exempt").
 */
const DECORATIVE: ReadonlySet<ColorToken> = new Set<ColorToken>(['borderDefault']);

function ratioOf(tokens: ThemeTokens, p: Pair): number {
  const surface = parse(tokens.color[p.bg]);
  const bg =
    surface.alpha < 1 ? over(tokens.color[p.bg], parse(tokens.color.bgCanvas).rgb) : surface.rgb;
  const fgParsed = parse(tokens.color[p.fg]);
  const fg = fgParsed.alpha < 1 ? over(tokens.color[p.fg], bg) : fgParsed.rgb;
  return contrastRatio(fg, bg);
}

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([30, 58, 95], [30, 58, 95])).toBe(1);
  });

  it('parses hex and composites a stray rgba tint over its surface', () => {
    expect(parse('#FFFFFF')).toEqual({ rgb: [255, 255, 255], alpha: 1 });
    expect(over('rgba(0,0,0,0.5)', [255, 255, 255])).toEqual([128, 128, 128]);
    expect(() => parse('red')).toThrow(/not a colour literal/);
  });
});

describe('the REQUIRED list is the design table', () => {
  it('lists every colour token but the decorative border in at least one pair', () => {
    const listed = new Set<ColorToken>();
    for (const p of REQUIRED) {
      listed.add(p.fg);
      listed.add(p.bg);
    }
    const names = (Object.keys(light.color) as ColorToken[]).filter((n) => !DECORATIVE.has(n));
    for (const name of names) {
      expect(listed.has(name), `no pair measures ${name}`).toBe(true);
    }
  });

  it('never measures textMuted on a tint, nor accent as a foreground (R12.14)', () => {
    for (const p of REQUIRED) {
      if (p.fg === 'textMuted') {
        expect(['bgCanvas', 'bgSurface', 'bgElevated']).toContain(p.bg);
      }
      expect(p.fg, p.where).not.toBe('accent');
    }
  });
});

/** Every `.tsx` under `src/` that is not a test: the component kit and the screens. */
function drawingSources(): string[] {
  const root = path.resolve(__dirname, '..');
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name),
    )
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * The colour tokens a source file draws: `tokens.color.x`, `tokens.color[x]`, `color="x"` and any
 * quoted token name (the `ColorToken`-typed maps in `StatusCard` / `Chip` and the ternaries in
 * screens).
 */
function tokensDrawnBy(source: string): Set<ColorToken> {
  const names = Object.keys(light.color) as ColorToken[];
  const found = new Set<ColorToken>();
  for (const name of names) {
    const quoted = new RegExp(`['"]${name}['"]`);
    const member = new RegExp(`tokens\\.color\\.${name}\\b`);
    if (quoted.test(source) || member.test(source)) {
      found.add(name);
    }
  }
  return found;
}

describe('every colour the kit and the screens draw is listed (R12.4)', () => {
  const listed = new Set<ColorToken>(DECORATIVE);
  for (const p of REQUIRED) {
    listed.add(p.fg);
    listed.add(p.bg);
  }

  const files = drawingSources();

  it('finds the component kit and the screens', () => {
    expect(files.some((f) => f.endsWith(`${path.sep}components${path.sep}Button.tsx`))).toBe(true);
    expect(
      files.some((f) => f.endsWith(`${path.sep}components${path.sep}GradientHeader.tsx`)),
    ).toBe(true);
    expect(files.some((f) => f.endsWith(`${path.sep}home${path.sep}HomeScreen.tsx`))).toBe(true);
  });

  it.each(files.map((f) => [path.relative(path.resolve(__dirname, '..'), f), f] as const))(
    '%s draws only tokens some pair measures',
    (_rel, file) => {
      const drawn = tokensDrawnBy(readFileSync(file, 'utf8'));
      for (const token of drawn) {
        expect(listed.has(token), `add a pair for ${token}`).toBe(true);
      }
    },
  );
});

describe.each(['light', 'dark'] as const)(
  'token pairs the kit draws, %s theme (R12.4)',
  (scheme) => {
    const tokens = TOKENS[scheme];

    it.each(REQUIRED.map((p) => [`${p.fg} on ${p.bg} ≥ ${p.min} — ${p.where}`, p] as const))(
      '%s',
      (_name, p) => {
        const ratio = ratioOf(tokens, p);
        expect(ratio, `${p.fg} on ${p.bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(p.min);
      },
    );
  },
);
