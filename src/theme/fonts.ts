/**
 * Loads the bundled Plus Jakarta Sans weights with `expo-font` (R12.2). `App.tsx` calls
 * `useAppFonts()` and renders nothing until it answers `true`, so no screen is ever drawn in the
 * system font and then re-laid out. The one Expo import lives here so `typography.ts` stays pure
 * and testable in node.
 */
import { useFonts } from 'expo-font';

import { FONT_ASSETS } from './typography';

/**
 * `true` once the four weights are registered. An error (a corrupt file would be a build defect,
 * not a runtime condition) is also `true`: React Native then falls back to the system font, which
 * is better than a blank app. The error is logged once for the developer.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONT_ASSETS);
  if (error) {
    console.warn('[attendance] fonts', error);
    return true;
  }
  return loaded;
}
