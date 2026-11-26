/**
 * The app's design system (design DD15): tokens, type scale, theme, motion and haptics. Components
 * (`src/components`, task 12.2) and screens import from here; `fonts.ts` is imported by `App.tsx`
 * only, and `haptics.ts` by the punch flow's callers only.
 */
export { dark, light, TOKENS } from './tokens';
export type {
  CardShadow,
  ColorScheme,
  ColorToken,
  GradientToken,
  RadiusToken,
  ShadowToken,
  SpaceToken,
  ThemeTokens,
} from './tokens';
export { fontFamily, FONT_ASSETS, TEXT_SCALING, typeScale } from './typography';
export type { FontFamily, TypeRole, TypeRoleName } from './typography';
export {
  isThemeOverride,
  resolveTheme,
  staticTheme,
  THEME_OVERRIDES,
  ThemeContext,
  useTheme,
} from './useTheme';
export type { SystemScheme, Theme, ThemeOverride } from './useTheme';
export { ThemeProvider, type ThemeProviderProps } from './ThemeProvider';
export { duration, easing, motionDuration, useMotionDuration, useReducedMotion } from './motion';
