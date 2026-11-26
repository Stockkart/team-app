/**
 * Renders a component kit element under one theme for tests (`src/components/*.test.tsx`). Uses
 * `staticTheme`, so no `ThemeProvider`, `Appearance` or secure store is involved.
 */
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

import { staticTheme, ThemeContext, type ColorScheme } from '../src/theme';

export const SCHEMES: readonly ColorScheme[] = ['light', 'dark'];

export function renderThemed(ui: ReactElement, scheme: ColorScheme = 'light'): RenderResult {
  return render(<ThemeContext.Provider value={staticTheme(scheme)}>{ui}</ThemeContext.Provider>);
}
