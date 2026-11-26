/**
 * React Native's `AppState` as the {@link ForegroundSource} `useAppState` re-resolves on: the
 * listener fires each time the app becomes `active` after having been in the background or
 * inactive (R3.10, R6.1). Imported by the composition root only; tests pass their own source.
 */
import { AppState, type AppStateStatus } from 'react-native';

import type { ForegroundSource } from './useAppState';

export const appStateForeground: ForegroundSource = {
  subscribe(listener) {
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') {
        listener();
      }
      previous = next;
    });
    return () => subscription.remove();
  },
};
