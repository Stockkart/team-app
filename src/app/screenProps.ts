/**
 * What every worker-app screen receives from `RootNavigator` (task 13.4): the app's dependencies
 * (`AppDeps`, so no screen imports `expo-*` or the navigator) and the shell's actions
 * (`ShellActions`: re-resolve, apply a fresh state, hand over a 401). Screen-specific data and
 * navigation callbacks are added per screen.
 */
import type { AppDeps } from './deps';
import type { ShellActions } from './useAppState';

export interface ShellScreenProps {
  deps: AppDeps;
  shell: ShellActions;
}
