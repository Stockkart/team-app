/**
 * Type scale of the Stockkart Team app (design "Design language", R12.2).
 *
 * The typeface is Plus Jakarta Sans, bundled with the app from `assets/fonts` (OFL-1.1, licence in
 * `assets/fonts/OFL.txt`; no network font load). The four static weights are registered under
 * the family names below by `useAppFonts()` (`fonts.ts`) before the first screen renders; React
 * Native picks a weight by family name, not by `fontWeight`, so every text style names a family.
 *
 * Sizes are in sp: they scale with the phone's font-size setting (`allowFontScaling`) up to 200 %
 * (`maxFontSizeMultiplier = 2`); every `Text` must spread `TEXT_SCALING`.
 */
import bold from '../../assets/fonts/PlusJakartaSans-Bold.ttf';
import medium from '../../assets/fonts/PlusJakartaSans-Medium.ttf';
import regular from '../../assets/fonts/PlusJakartaSans-Regular.ttf';
import semiBold from '../../assets/fonts/PlusJakartaSans-SemiBold.ttf';

/** Family names the four weights are registered under (`expo-font` key = `fontFamily` value). */
export const fontFamily = {
  regular: 'PlusJakartaSans-Regular',
  medium: 'PlusJakartaSans-Medium',
  semiBold: 'PlusJakartaSans-SemiBold',
  bold: 'PlusJakartaSans-Bold',
} as const;

export type FontFamily = (typeof fontFamily)[keyof typeof fontFamily];

/** Font files by family name, in the shape `expo-font`'s `useFonts` / `loadAsync` take. */
export const FONT_ASSETS: Readonly<Record<FontFamily, number>> = {
  [fontFamily.regular]: regular,
  [fontFamily.medium]: medium,
  [fontFamily.semiBold]: semiBold,
  [fontFamily.bold]: bold,
};

export interface TypeRole {
  /** sp */
  readonly fontSize: number;
  /** sp; 1.25 × size for the display and titles, 1.5 × for body copy, rounded to whole sp. */
  readonly lineHeight: number;
  readonly fontFamily: FontFamily;
}

/**
 * The six text roles. Use: `display` the punch time on the confirmation; `title` screen titles and
 * the greeting; `heading` card titles; `buttonPrimary` the primary button label; `body` body copy,
 * tile labels and inputs; `secondary` helper text, dates and "Last updated".
 */
export const typeScale = {
  display: { fontSize: 40, lineHeight: 48, fontFamily: fontFamily.bold },
  title: { fontSize: 24, lineHeight: 30, fontFamily: fontFamily.semiBold },
  heading: { fontSize: 20, lineHeight: 26, fontFamily: fontFamily.semiBold },
  buttonPrimary: { fontSize: 18, lineHeight: 24, fontFamily: fontFamily.semiBold },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fontFamily.regular },
  secondary: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.regular },
} as const satisfies Record<string, TypeRole>;

export type TypeRoleName = keyof typeof typeScale;

/**
 * Props every `Text` and `TextInput` spreads: the phone's font-size setting applies, capped at
 * 200 % so no layout has to survive more than that (R12.2).
 */
export const TEXT_SCALING = {
  allowFontScaling: true,
  maxFontSizeMultiplier: 2,
} as const;
