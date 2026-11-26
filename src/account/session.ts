/**
 * What the three account screens share once the server has answered (worker-app R1.5, R1.6, R1.7,
 * R1.9, R9.6, R9.7; design "App-side rules"):
 *
 * - {@link completeSignIn}: a sign-in or sign-up answer becomes the phone's account. In order:
 *   1. **Another account's pairing?** When this phone holds a pairing whose recorded owner
 *      (`authStore.pairingOwnerUserId`, written when the pairing was completed and kept across log
 *      out, R9.5) is not the account signing in, the R9.7 switch runs first (`switchAccount`: warn
 *      about waiting punches, confirm, unpair once, wipe the device set). No server call decides
 *      this; a pairing with no recorded owner is treated as another account's. A cancel stores
 *      nothing and the sign-in does not proceed; the screen stays.
 *   2. **Another account's data?** When the account last signed in here (the stored profile, kept
 *      across a session end) differs, its set goes (`AuthStore.clearForLogout`: last state,
 *      dismissed card, the history and notifications caches), so the new account never sees it.
 *   3. The answer is stored (`AuthStore.saveAccount`: the profile, then the token), the chosen photo,
 *      if any, is uploaded with the new session and its URL kept on the profile, and the shell
 *      re-resolves (`ShellActions.refresh`), which lands on Join, Waiting, Home or Blocked (R6.1).
 *   The **same** account signing in again touches nothing of the device set: the pairing stays, Home
 *   opens with Attendance Enabled and no code is needed (R9.6). Nothing is stored before the server
 *   has created or confirmed the account (R1.9): a `NotReachable` or a refusal never reaches this
 *   function.
 * - {@link accountErrorText}: the sentence a screen shows for a failed account call: the server's
 *   refusal word for word (`ServerRefusal.message`, e.g. "Invalid email or password"), the screen's
 *   own not-reachable line for `NotReachable`, and a generic line for anything else. A 401 is
 *   never shown here: screens hand every error to `ShellActions.handleError` first (R9.3).
 * - {@link nameFromIdToken}: the first name in a Google ID token's payload, for the greeting of the
 *   phone-and-photo screen ("Almost done, Ramesh", R1.4, R1.10). Read from the token's unverified
 *   payload for display only; the server verifies the token.
 * - {@link emailFromIdToken}: the `email` claim of the same payload, for the phone step's params
 *   (R1.10, R1.13): display only, never sent, never stored; the server reads the e-mail from the
 *   token it verifies.
 *
 * Pure apart from the injected deps; no React, no Expo.
 */
import { isNotReachable, isServerRefusal } from '../api/transport';
import type { AccountClient } from '../api/accountClient';
import type { ShellActions } from '../app/useAppState';
import { t } from '../i18n';
import { base64Decode } from '../signer/base64';
import type { AuthStore, StoredAccount } from '../state/authStore';
import type { PairingStore } from '../state/pairingStore';
import type { PreparedPhoto } from './photo';
import { needsAccountSwitch, switchAccount, type SwitchAccountDeps } from './switchAccount';

export interface CompleteSignInDeps extends SwitchAccountDeps {
  authStore: Pick<
    AuthStore,
    'saveAccount' | 'updateProfile' | 'profile' | 'clearForLogout' | 'pairingOwnerUserId'
  >;
  account: Pick<AccountClient, 'uploadPhoto'>;
  pairingStore: Pick<PairingStore, 'load' | 'wipe'>;
  /** Where a failed photo upload or store step is reported (`console.warn` by default); none fails the sign-in. */
  onError?: (context: string, error: unknown) => void;
}

export type CompleteSignInResult =
  /** The account is stored and the shell re-resolved. */
  | 'signed_in'
  /** The worker declined to switch accounts (R9.7): nothing stored, nothing re-resolved. */
  | 'cancelled';

/**
 * Switch if another account's pairing is here, drop the previous account's set, store, upload the
 * optional photo, re-resolve (see the module note). The photo upload is best effort: the account
 * exists either way, and the worker can add the photo from Profile later (R8.2).
 */
export async function completeSignIn(
  deps: CompleteSignInDeps,
  shell: Pick<ShellActions, 'refresh' | 'confirm'>,
  account: StoredAccount,
  photo: PreparedPhoto | null = null,
): Promise<CompleteSignInResult> {
  const report = deps.onError ?? warn;
  const previous = await deps.authStore.profile();
  const previousUserId = previous?.userId ?? null;

  const pairing = await deps.pairingStore.load().catch((error: unknown) => {
    report('pairing store', error);
    return null;
  });
  if (pairing != null) {
    const pairingOwnerUserId = await deps.authStore.pairingOwnerUserId().catch((error: unknown) => {
      report('pairing owner', error);
      return null;
    });
    if (needsAccountSwitch({ pairing, pairingOwnerUserId, userId: account.userId })) {
      const switched = await switchAccount({ ...deps, onError: report }, shell.confirm);
      if (switched === 'cancelled') {
        return 'cancelled';
      }
    }
  }

  if (previousUserId != null && previousUserId !== account.userId) {
    await deps.authStore
      .clearForLogout()
      .catch((error: unknown) => report('clear previous account', error));
  }

  await deps.authStore.saveAccount(account);
  if (photo) {
    try {
      const uploaded = await deps.account.uploadPhoto({
        uri: photo.uri,
        contentType: photo.contentType,
      });
      await deps.authStore.updateProfile({ photoUrl: uploaded.photoUrl });
    } catch (error) {
      report('photo upload', error);
    }
  }
  await shell.refresh();
  return 'signed_in';
}

function warn(context: string, error: unknown): void {
  console.warn(`[attendance] ${context}`, error);
}

/** The sentence to show for a failed sign-in, sign-up or similar call (see the module note). */
export function accountErrorText(error: unknown, notReachableText: string): string {
  if (isNotReachable(error)) {
    return notReachableText;
  }
  if (isServerRefusal(error)) {
    return error.message;
  }
  return t('common.somethingWentWrong');
}

/**
 * The person's first name from a Google ID token (`given_name`, else the first word of `name`), or
 * `null` when the token has neither or is not a JWT. Display only.
 */
export function nameFromIdToken(idToken: string): string | null {
  const claims = idTokenClaims(idToken);
  if (claims == null) {
    return null;
  }
  const given = typeof claims.given_name === 'string' ? claims.given_name.trim() : '';
  if (given.length > 0) {
    return given;
  }
  const full = typeof claims.name === 'string' ? claims.name.trim() : '';
  const first = full.split(/\s+/)[0] ?? '';
  return first.length > 0 ? first : null;
}

/**
 * The `email` claim of a Google ID token, trimmed, or `null` when absent, blank or the text is not
 * a JWT. Display only (R1.10, R1.13): the server reads the e-mail from the token it verifies.
 */
export function emailFromIdToken(idToken: string): string | null {
  const claims = idTokenClaims(idToken);
  if (claims == null) {
    return null;
  }
  const email = typeof claims.email === 'string' ? claims.email.trim() : '';
  return email.length > 0 ? email : null;
}

/**
 * The payload of a JWT as an object, read without verifying the signature (base64url, UTF-8,
 * JSON), or `null` when the text is not shaped like one. Shared by the two `*FromIdToken` readers.
 */
function idTokenClaims(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.');
  if (parts.length < 2) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(utf8Decode(base64Decode(base64UrlToBase64(parts[1]))));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function base64UrlToBase64(text: string): string {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const rest = base64.length % 4;
  return rest === 0 ? base64 : base64 + '='.repeat(4 - rest);
}

/** UTF-8 bytes to text without `TextDecoder` (not on every Hermes build). */
function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 < 0xe0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b0 < 0xf0) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const code =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(code);
      i += 4;
    }
  }
  return out;
}
