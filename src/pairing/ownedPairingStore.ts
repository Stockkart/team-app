/**
 * The pairing store as the Stockkart Team app's `PairingFlow` sees it (worker-app design "Stores",
 * "Clients"; R9.5–R9.7, R11.8): `save()` stores the pairing record as before and then writes
 * `authStore.pairingOwnerUserId`, the id of the account that is signed in while the code is
 * redeemed. That id is what the next sign-in compares itself with: the same account finds its
 * pairing and needs no code (R9.6); a different one is asked to switch (`switchAccount`, R9.7).
 *
 * The owner id goes with the pairing (`PairingStore.wipe()` runs `AuthStore.clearPairingOwner`),
 * never with the account set (`clearForLogout` keeps it, R9.5), so the two writes are kept
 * together here: a pairing record without an owner is treated as another account's at the next
 * sign-in, so a failed owner write is reported through `onError` rather than swallowed.
 *
 * Pure: no React, no Expo.
 */
import type { AuthStore } from '../state/authStore';
import type { PairingStoreLike } from './PairingFlow';

export interface PairingOwnerSource {
  /** The signed-in account's id, or null when none is stored (the worker path always has one). */
  profile: AuthStore['profile'];
  setPairingOwnerUserId: AuthStore['setPairingOwnerUserId'];
}

/**
 * Wraps `store` so that a completed pairing also records which account made it. `installationId`
 * passes through unchanged.
 */
export function ownedPairingStore(
  store: PairingStoreLike,
  auth: PairingOwnerSource,
  onError: (context: string, error: unknown) => void = warn,
): PairingStoreLike {
  return {
    installationId: () => store.installationId(),
    async save(pairing) {
      await store.save(pairing);
      try {
        const profile = await auth.profile();
        if (profile == null) {
          throw new Error('no account is signed in');
        }
        await auth.setPairingOwnerUserId(profile.userId);
      } catch (error) {
        onError('record pairing owner', error);
      }
    },
  };
}

function warn(context: string, error: unknown): void {
  console.warn(`[attendance] ${context}`, error);
}
