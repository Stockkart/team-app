import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createAppDeps } from './src/app/deps';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAppFonts } from './src/theme/fonts';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { useTheme } from './src/theme/useTheme';
import type { ThemeOverride } from './src/theme/useTheme';

/**
 * Root component: loads the bundled typeface before anything is drawn (R12.2), builds the app's
 * dependencies once (`src/app/deps.ts`) and mounts the one stack (`src/navigation/RootNavigator.tsx`)
 * inside the `ThemeProvider` (R12.10). The theme override is read from the account store at start
 * (it survives log out) and written back on every change a screen makes.
 */
export function App() {
  const fontsReady = useAppFonts();
  const deps = useMemo(() => createAppDeps(), []);
  const [override, setOverride] = useState<ThemeOverride>('system');

  useEffect(() => {
    deps.authStore
      .themeOverride()
      .then(setOverride)
      .catch(() => undefined);
  }, [deps]);

  if (!fontsReady) {
    // Nothing is drawn in the system font and re-laid out a moment later; the splash screen stays.
    return null;
  }
  return (
    <SafeAreaProvider>
      <ThemeProvider
        override={override}
        onOverrideChange={(next) => {
          setOverride(next);
          void deps.authStore.setThemeOverride(next).catch(() => undefined);
        }}
      >
        <RootNavigator deps={deps} />
        <ThemedStatusBar />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Status-bar icons in the colour that reads on the current theme's canvas. */
function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}
