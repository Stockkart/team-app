/**
 * Signing in with a different account than the one this phone's pairing belongs to (worker-app
 * R9.7; design "Sequence: log out, and sign-in with a different account", Property 23).
 *
 * A pairing is one employee's; a logged-out phone still holds its keys so the same account can
 * come back without a new code (D9). A **different** account must not inherit it, so before that
 * account's sign-in completes the phone:
 *
 * 1. warns, through the shell's confirm sheet, that the stored pairing goes and that the waiting
 *    offline punches of the previous account go with it: "N punches that were not yet sent will be
 *    lost" (one line for 1, none when the queue is empty: `PunchQueue.waitingCount`);
 * 2. on confirm, tells the server once (`POST /attendance-app/pairings/me/unpair`, signed with the
 *    device key) and goes on **whatever the answer**: not reachable, already unpaired, any refusal.
 *    The local data is deleted anyway; a server-side pairing left ACTIVE can never punch again (its
 *    key is gone) and the manager unpairs it from the employee page (R9.7);
 * 3. wipes the device set (`PairingStore.wipe()`: record, installation id, both hardware keys, the
 *    offline queue and the pairing's owner id, HR R9.6, worker-app R9.5);
 * 4. lets the caller finish: `completeSignIn` stores the new account and re-resolves.
 *
 * Cancel leaves everything untouched and the sign-in does not proceed (`completeSignIn` stores
 * nothing, the fresh token is dropped).
 *
 * One thing decides that a switch is needed, pure and tested on its own: {@link needsAccountSwitch}
 * compares the account signing in with `authStore.pairingOwnerUserId`, the account that completed
 * the stored pairing (written by `ownedPairingStore` on completion, kept across log out, R9.5). No
 * server call is involved in the decision. A pairing with no recorded owner is treated as another
 * account's: the worker is asked rather than handed someone else's keys.
 *
 * Pure apart from the injected deps: no React, no Expo.
 */
import type { AppClient } from '../api/appClient';
import { isNotReachable, isServerRefusal } from '../api/transport';
import type { Confirm, ConfirmPrompt } from '../app/useAppState';
import { t } from '../i18n';
import type { PunchQueue } from '../queue/PunchQueue';
import type { PairingRecord, PairingStore } from '../state/pairingStore';

export interface SwitchAccountDeps {
  /** How many offline punches would be lost (R9.7). */
  queue: Pick<PunchQueue, 'waitingCount'>;
  /** The device-envelope client: the one unpair call. */
  client: Pick<AppClient, 'unpairMe'>;
  /** Deletes the device set after the unpair call (HR R9.6), the owner id with it (R9.5). */
  pairingStore: Pick<PairingStore, 'wipe'>;
  /** Where a failed count, an unexpected refusal or a failed wipe is reported; none stops the switch. */
  onError?: (context: string, error: unknown) => void;
}

export type SwitchAccountResult =
  /** Confirmed: the unpair call was made once and the device set is gone. */
  | 'switched'
  /** Cancelled: nothing was touched. */
  | 'cancelled';

// --- the pure parts ---

export interface AccountSwitchInputs {
  /** The stored pairing, or null when this phone is not paired. */
  pairing: Pick<PairingRecord, 'pairingId'> | null;
  /** `authStore.pairingOwnerUserId`: who completed the pairing, or null when nothing is recorded. */
  pairingOwnerUserId: string | null;
  /** The account signing in now. */
  userId: string;
}

/**
 * True when a pairing is stored and the account signing in is not the one that made it
 * (`pairingOwnerUserId !== userId`, R9.7). Without a pairing there is nothing to switch; the same
 * owner needs nothing (R9.6); a pairing with no recorded owner counts as another account's.
 */
export function needsAccountSwitch(inputs: AccountSwitchInputs): boolean {
  return inputs.pairing != null && inputs.pairingOwnerUserId !== inputs.userId;
}

/**
 * The sheet's texts for `waiting` punches still to be sent: the question, the explanation and,
 * when `waiting > 0`, the R9.7 warning ("1 punch that was not yet sent will be lost" / "N punches
 * that were not yet sent will be lost").
 */
export function switchAccountPrompt(waiting: number): ConfirmPrompt {
  const lines = [t('switchAccount.explanation')];
  if (waiting === 1) {
    lines.push(t('switchAccount.lostPunchesOne'));
  } else if (waiting > 1) {
    lines.push(t('switchAccount.lostPunches', { count: waiting }));
  }
  return {
    question: t('switchAccount.question'),
    explanation: lines.join(' '),
    confirmLabel: t('switchAccount.confirm'),
    cancelLabel: t('common.cancel'),
  };
}

// --- the flow ---

/**
 * Warn → confirm → unpair once → wipe. Returns `'cancelled'` with nothing touched when the worker
 * declines. Never throws: a failed step is reported and the switch goes on (R9.7).
 */
export async function switchAccount(
  deps: SwitchAccountDeps,
  confirm: Confirm,
): Promise<SwitchAccountResult> {
  let waiting = 0;
  try {
    waiting = await deps.queue.waitingCount();
  } catch (error) {
    deps.onError?.('waiting count', error);
  }

  if (!(await confirm(switchAccountPrompt(waiting)))) {
    return 'cancelled';
  }

  try {
    await deps.client.unpairMe();
  } catch (error) {
    // Not reachable, already unpaired, refused: the local data goes anyway (R9.7). Only the
    // unexpected case is worth a report.
    if (!isNotReachable(error) && !(isServerRefusal(error) && error.notPaired)) {
      deps.onError?.('unpair call', error);
    }
  }

  try {
    await deps.pairingStore.wipe();
  } catch (error) {
    deps.onError?.('wipe pairing', error);
  }
  return 'switched';
}
