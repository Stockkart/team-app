/**
 * Design tokens of the Stockkart Team app (design "Design language", R12.1, R12.13, R12.15; D14).
 *
 * The palette is the app's own, **violet & peach**: it does not copy the web's ui-kit colours and
 * no test compares the two (design DD15). This is the **only** file in the app that may contain a
 * colour literal (the `no-restricted-syntax` rule in `eslint.config.mjs` fails the build on a hex
 * or `rgba(` literal anywhere else). Screens and components read colours through `useTheme()`.
 *
 * Every (foreground, surface) pair the kit draws is listed with its WCAG threshold in
 * `contrast.test.ts` (R12.4); the token *set* (keys, `#RRGGBB` shape, both themes) is checked by
 * `tokens.test.ts`. Three light values were moved within the owner's 10 % lightness budget to pass
 * the gate and are recorded in the design's "Colour tokens" table: `success` `#047854` (from
 * `#059669`), `danger` `#CF1B42` (from `#E11D48`), `textMuted` `#706A8C` (from `#8B86A3`; the
 * original lives on as `borderStrong`, whose rule is 3:1).
 *
 * Rules the pairs imply (enforced by the kit, see the design): `accent` (peach) is a fill only
 * (R12.14) and text on it is `textOnAccent`; text on `brand` / `success` / `danger` is
 * `textInverse`; `textMuted` sits on `bgCanvas`, `bgSurface` or `bgElevated` only, never on a
 * tint; a tinted card or chip draws its text in `textPrimary` / `textSecondary` and the tone colour
 * only in its leading icon.
 */

export const light = {
  color: {
    brand: '#6D28D9',
    brandSoft: '#EDE9FE',
    accent: '#FDBA74',
    accentSoft: '#FFEDD5',
    accentText: '#C2410C',
    textOnAccent: '#1E1B2E',
    success: '#047854',
    successSoft: '#D1FAE5',
    warning: '#B45309',
    warningSoft: '#FEF3C7',
    danger: '#CF1B42',
    dangerSoft: '#FFE4E6',
    bgCanvas: '#FAF8FF',
    bgSurface: '#F3F0FB',
    bgElevated: '#FFFFFF',
    /** Same value as `brandSoft`; kept as a key so existing imports compile (Banner, disabled fills). */
    bgMuted: '#EDE9FE',
    textPrimary: '#1E1B2E',
    textSecondary: '#5B5675',
    textMuted: '#706A8C',
    textInverse: '#FFFFFF',
    /** Decorative: card edge in dark, dividers. Not a control outline; exempt from the gate (R12.4). */
    borderDefault: '#E9E4F5',
    borderStrong: '#8B86A3',
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  /** `sm`–`full` are kept for existing imports; new drawing uses `field`, `card` and `pill`. */
  radius: { sm: 4, md: 8, lg: 12, xl: 14, full: 9999, field: 12, card: 20, pill: 999 },
  shadow: {
    /** Cards in light: Android elevation 2; iOS 8 % opacity, 12 dp blur (R12.15). */
    card: {
      shadowColor: '#1E1B2E',
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
  },
  /** Token names; `GradientHeader` resolves them (start top-left → end bottom-right, R12.16). */
  gradient: { header: ['brandSoft', 'accentSoft'] as const },
} as const;

/**
 * Dark theme (R12.13): every colour changes except `accent` (peach stays a fill in both themes);
 * cards draw no shadow and a 1 px `borderDefault` edge instead. Spacing, radii and the gradient's
 * token names are the same in both themes.
 */
export const dark = {
  ...light,
  color: {
    brand: '#A78BFA',
    brandSoft: '#2E2650',
    accent: '#FDBA74',
    accentSoft: '#3B2A1E',
    accentText: '#FDBA74',
    textOnAccent: '#120F1F',
    success: '#34D399',
    successSoft: '#0F3B2E',
    warning: '#FCD34D',
    warningSoft: '#3F2E0A',
    danger: '#FB7185',
    dangerSoft: '#4A1A26',
    bgCanvas: '#120F1F',
    bgSurface: '#171329',
    bgElevated: '#1C1830',
    bgMuted: '#2E2650',
    textPrimary: '#F3F0FF',
    textSecondary: '#B9B3D1',
    textMuted: '#867FA3',
    textInverse: '#120F1F',
    borderDefault: '#2C2744',
    borderStrong: '#756E96',
  },
  shadow: {
    card: {
      shadowColor: '#000000',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
  },
} as const;

/** The style a card spreads for its shadow (`shadow.card`); zero in the dark theme. */
export type CardShadow = {
  readonly shadowColor: string;
  readonly shadowOpacity: number;
  readonly shadowRadius: number;
  readonly shadowOffset: { readonly width: number; readonly height: number };
  readonly elevation: number;
};

/** One theme's tokens: what `useTheme().tokens` returns. */
export type ThemeTokens = {
  readonly color: { readonly [K in keyof typeof light.color]: string };
  readonly space: { readonly [K in keyof typeof light.space]: number };
  readonly radius: { readonly [K in keyof typeof light.radius]: number };
  readonly shadow: { readonly [K in keyof typeof light.shadow]: CardShadow };
  readonly gradient: {
    readonly [K in keyof typeof light.gradient]: readonly [ColorToken, ColorToken];
  };
};

export type ColorToken = keyof typeof light.color;
export type SpaceToken = keyof ThemeTokens['space'];
export type RadiusToken = keyof ThemeTokens['radius'];
export type ShadowToken = keyof ThemeTokens['shadow'];
export type GradientToken = keyof ThemeTokens['gradient'];

/** The two colour schemes the app can draw in. */
export type ColorScheme = 'light' | 'dark';

export const TOKENS: Readonly<Record<ColorScheme, ThemeTokens>> = { light, dark };
