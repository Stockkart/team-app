/**
 * Log out from a screen before Home (Join, Waiting, Blocked; R6.2, R8.5, R9.5). The one log-out
 * module is `src/account/logout.ts` (task 14.4); this seam keeps the three screens' call shape,
 * `logOut(deps, shell, onError?)`, and delegates every step to it: server first (best effort),
 * then `AuthStore.clearForLogout()` (the account set and the two caches; the theme choice stays,
 * R12.10), then the shell re-resolves and lands on Sign in. The pairing, the hardware keys and the
 * offline queue are not touched (D9).
 */
import { logout, type LogoutDeps } from '../account/logout';
import type { ShellActions } from '../app/useAppState';

export type LogOutDeps = Pick<LogoutDeps, 'account' | 'authStore'>;

/** Never throws; failures are reported through `onError` when given. */
export function logOut(
  deps: LogOutDeps,
  shell: Pick<ShellActions, 'refresh'>,
  onError?: (context: string, error: unknown) => void,
): Promise<void> {
  return logout(
    onError ? { account: deps.account, authStore: deps.authStore, onError } : deps,
    shell,
  );
}
