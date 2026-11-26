/**
 * Log out (worker-app R8.5, R9.5, R11.8; design "Sequence: log out"): tells the server to end the
 * session (`POST /auth/logout`, best effort: a phone without network still logs out), deletes the
 * account set from the phone (`AuthStore.clearForLogout`: token, profile, last state, dismissed
 * outcome, and through it the history and notifications caches), and leaves the
 * device set alone (D9: pairing record, installation id, hardware keys, location settings, consent,
 * waiting offline punches) and the theme choice (R12.10). Then the shell re-resolves and lands on
 * Sign in.
 *
 * "Remove this phone" is a different operation with a different keep-set (`settings/removePhone.ts`,
 * HR R3.7); the Profile screen labels and confirms the two separately. The screens before Home call
 * this through `src/join/logOut.ts`, which only delegates here.
 */
import type { AccountClient } from '../api/accountClient';
import type { ShellActions } from '../app/useAppState';
import type { AuthStore } from '../state/authStore';

export interface LogoutDeps {
  account: Pick<AccountClient, 'logout'>;
  authStore: Pick<AuthStore, 'clearForLogout'>;
  /** Where a failed server call or store step is reported; neither stops the log out. */
  onError?: (context: string, error: unknown) => void;
}

export async function logout(
  deps: LogoutDeps,
  shell: Pick<ShellActions, 'refresh'>,
): Promise<void> {
  try {
    await deps.account.logout();
  } catch (error) {
    deps.onError?.('logout call', error);
  }
  try {
    await deps.authStore.clearForLogout();
  } catch (error) {
    deps.onError?.('clear for logout', error);
  }
  await shell.refresh();
}
