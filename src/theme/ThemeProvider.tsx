/**
 * Supplies the theme to every screen (R12.10). The phone's light / dark setting comes from React
 * Native's `useColorScheme` (`Appearance`, re-rendered when the setting changes); the worker's
 * override comes in as a prop so its owner (the secure store, task 13.2) stays outside this
 * component. `onOverrideChange` fires when a screen calls `setOverride`; until the owner passes
 * the new value back, the provider shows it from its own state so the switch is immediate.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { TOKENS } from './tokens';
import { ThemeContext, resolveTheme, type Theme, type ThemeOverride } from './useTheme';

export interface ThemeProviderProps {
  /** The persisted choice; `undefined` means `system`. */
  override?: ThemeOverride;
  /** Called with every change a screen makes, so the caller can persist it. */
  onOverrideChange?: (override: ThemeOverride) => void;
  children: ReactNode;
}

export function ThemeProvider({ override, onOverrideChange, children }: ThemeProviderProps) {
  const system = useColorScheme();
  const [current, setCurrent] = useState<ThemeOverride>(override ?? 'system');

  // The owner's value wins whenever it changes (e.g. after the store loads on start-up).
  useEffect(() => {
    setCurrent(override ?? 'system');
  }, [override]);

  const setOverride = useCallback(
    (next: ThemeOverride) => {
      setCurrent(next);
      onOverrideChange?.(next);
    },
    [onOverrideChange],
  );

  const value = useMemo<Theme>(() => {
    const scheme = resolveTheme(system, current);
    return { scheme, tokens: TOKENS[scheme], override: current, setOverride };
  }, [system, current, setOverride]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
