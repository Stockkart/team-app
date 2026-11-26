/**
 * Theme resolution and the hook screens read it through (R12.10).
 *
 * `resolveTheme` is pure: the phone's colour scheme plus the worker's override give the scheme to
 * draw in. The override is one of `system | light | dark`; it is kept in the secure store next
 * to the account (`authStore.themeOverride`, task 13.2) and survives log out, so a worker who
 * chose Dark keeps it on the Sign in screen.
 */
import { createContext, useContext } from 'react';

import { TOKENS, type ColorScheme, type ThemeTokens } from './tokens';

/** What the worker picked in Profile → Theme. `system` follows the phone. */
export type ThemeOverride = 'system' | ColorScheme;

export const THEME_OVERRIDES: readonly ThemeOverride[] = ['system', 'light', 'dark'];

export function isThemeOverride(value: unknown): value is ThemeOverride {
  return typeof value === 'string' && (THEME_OVERRIDES as readonly string[]).includes(value);
}

/**
 * What the phone reports. React Native's `ColorSchemeName` is `'light' | 'dark' | 'unspecified' |
 * null | undefined`; anything but `'dark'` draws light.
 */
export type SystemScheme = ColorScheme | 'unspecified' | null | undefined;

/**
 * The scheme to draw in: `override` unless it is `system`, then the phone's scheme, then `light`
 * when the phone reports none (`Appearance.getColorScheme()` is `null`, `undefined` or
 * `'unspecified'` on some Android builds before the first render).
 */
export function resolveTheme(
  system: SystemScheme,
  override: ThemeOverride | null | undefined,
): ColorScheme {
  if (override === 'light' || override === 'dark') {
    return override;
  }
  return system === 'dark' ? 'dark' : 'light';
}

export interface Theme {
  /** The scheme in use after the override is applied. */
  readonly scheme: ColorScheme;
  readonly tokens: ThemeTokens;
  /** The worker's choice (`system` when none). */
  readonly override: ThemeOverride;
  /** Changes the choice for this process; `ThemeProvider` reports it so the caller can persist it. */
  setOverride(override: ThemeOverride): void;
}

/** A theme for code that runs outside a `ThemeProvider` (tests, the fallback in `useTheme`). */
export function staticTheme(scheme: ColorScheme, override: ThemeOverride = 'system'): Theme {
  return {
    scheme,
    tokens: TOKENS[scheme],
    override,
    setOverride: () => undefined,
  };
}

export const ThemeContext = createContext<Theme | null>(null);

/** The current theme. Outside a `ThemeProvider` it answers the light theme with a no-op setter. */
export function useTheme(): Theme {
  return useContext(ThemeContext) ?? staticTheme('light');
}
