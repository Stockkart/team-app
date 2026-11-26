/**
 * The phone step (worker-app R1.4, R1.10–R1.13; design "Google sign-in without an account, and the
 * phone step", DD20). One screen with a `mode`:
 *
 * - `signup` (the `SignedOut` group): the Google sign-up's second step, reached from Create account
 *   or from Sign in when the server answered `OAUTH_ACCOUNT_NOT_FOUND` (R1.10). "Almost done,
 *   Ramesh", the phone number (required: an account is never created with an empty phone), an
 *   optional photo, **Create account**, and Back. Google gave the name and e-mail; the ID token
 *   arrives in the route params, lives in this screen's state only (R1.13), and is sent once, with
 *   the phone, to `AccountClient.createAccountWithGoogle` (role `WORKER`, `source: worker-app`),
 *   then `completeSignIn`. When the server refuses the token (`INVALID_CREDENTIALS` on
 *   `/auth/signup`: expired, or a foreign audience), the typed phone and the picked photo stay,
 *   "Google sign-in expired. Try again." is shown with a **Continue with Google** secondary button
 *   that asks Google for a new token and resubmits (R1.13).
 * - `update` (the `NeedsPhone` group): a signed-in account without a phone (R1.11): "Add your phone
 *   number", the same phone field and helper, the same optional photo, **Save** →
 *   `AccountClient.updateAccountProfile({phone})` (`PUT /users/me/profile`, the phone alone) →
 *   `uploadPhoto` when one was picked → `authStore.updateProfile` → `shell.refresh()`, which lands
 *   on the screen the account's state names. Log out is the only other control (R6.2); there is no
 *   Back, and hardware back leaves the app (R6.8).
 *
 * Same rules in both modes: the phone is checked on the phone first (`normalisePhone`, R1.12) and
 * nothing is sent while it fails; a refusal is shown word for word; "not reachable" stores nothing
 * and the step stays (R1.9, R1.12). Exactly one `PrimaryButton` in either mode (R12.5).
 */
import { useState } from 'react';
import { View } from 'react-native';

import { normalisePhone } from '@stockkart/attendance-protocol';

import {
  AppText,
  DangerButton,
  FormField,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextButton,
} from '../components';
import { isServerRefusal } from '../api/transport';
import type { ShellScreenProps } from '../app/screenProps';
import { t } from '../i18n';
import type { PhoneAndPhotoParams } from '../navigation/routes';
import type { AccountProfile } from '../state/authStore';
import { useTheme } from '../theme';
import { logout } from './logout';
import { PhotoField } from './PhotoField';
import type { PreparedPhoto } from './photo';
import { accountErrorText, completeSignIn } from './session';
import { validatePhone } from './validation';

export interface PhoneAndPhotoScreenProps extends ShellScreenProps {
  params: PhoneAndPhotoParams;
  /** `signup` mode: the Back control. Not shown in `update` mode. */
  onBack?: () => void;
  /** `update` mode: the signed-in account, for the photo's initial. */
  profile?: AccountProfile | null;
}

export function PhoneAndPhotoScreen({
  deps,
  shell,
  params,
  onBack,
  profile,
}: PhoneAndPhotoScreenProps) {
  const { tokens } = useTheme();
  const [phone, setPhone] = useState('');
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** `signup` only: the server refused the token; the next submit needs a new one (R1.13). */
  const [tokenExpired, setTokenExpired] = useState(false);
  /** `signup` only: the token in use, the route's until Google gives a fresh one (R1.13). */
  const [idToken, setIdToken] = useState(params.mode === 'signup' ? params.idToken : '');

  const update = params.mode === 'update';
  const name = (update ? profile?.name ?? '' : params.name).trim();
  const title = update
    ? t('phoneAndPhoto.updateTitle')
    : name
    ? t('phoneAndPhoto.title', { name })
    : t('phoneAndPhoto.titleNoName');

  /** The phone as typed when it passes the R1.2 rule, else null after showing the R1.12 text. */
  const checkedPhone = (): string | null => {
    const trimmed = phone.trim();
    const problem = validatePhone(trimmed);
    setPhoneError(problem ? t(problem) : null);
    return problem ? null : trimmed;
  };

  const fail = (error: unknown, notReachableText: string) => {
    if (!shell.handleError(error)) {
      setMessage(accountErrorText(error, notReachableText));
    }
  };

  // --- signup: create the WORKER account from the ID token and the phone (R1.4, R1.10) ---

  const create = async (token: string) => {
    if (busy) {
      return;
    }
    const checked = checkedPhone();
    if (checked == null) {
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const account = await deps.account.createAccountWithGoogle({
        idToken: token,
        phone: checked,
      });
      setTokenExpired(false);
      await completeSignIn(deps, shell, account, photo);
    } catch (error) {
      if (isServerRefusal(error) && error.code === 'INVALID_CREDENTIALS') {
        // The server refused the token (expired or foreign `aud`): phone and photo stay, ask for
        // Google once more (R1.13).
        setTokenExpired(true);
        setMessage(t('phoneAndPhoto.googleExpired'));
      } else {
        fail(error, t('createAccount.notReachable'));
      }
    } finally {
      setBusy(false);
    }
  };

  /** R1.13: a new token from Google, then the same sign-up with the typed phone and picked photo. */
  const retryWithGoogle = async () => {
    if (busy) {
      return;
    }
    setMessage(null);
    setBusy(true);
    let fresh: string | null = null;
    try {
      const result = await deps.googleSignIn.getIdToken();
      if (result.kind === 'id_token') {
        fresh = result.idToken;
        setIdToken(fresh);
      } else if (result.kind === 'unavailable') {
        setMessage(t('signIn.googleUnavailable'));
      } else {
        setMessage(t('phoneAndPhoto.googleExpired'));
      }
    } catch (error) {
      fail(error, t('createAccount.notReachable'));
    } finally {
      setBusy(false);
    }
    if (fresh != null) {
      await create(fresh);
    }
  };

  // --- update: save the phone on the existing account (R1.11, R1.12) ---

  const save = async () => {
    if (busy) {
      return;
    }
    const checked = checkedPhone();
    if (checked == null) {
      return;
    }
    // `validatePhone` passed, so this is the 10 digits the server will store too (R1.12).
    const normalised = normalisePhone(checked) as string;
    setMessage(null);
    setBusy(true);
    try {
      const saved = await deps.account.updateAccountProfile({ phone: normalised });
      const change: Partial<AccountProfile> = {
        phone: typeof saved.phone === 'string' && saved.phone.length > 0 ? saved.phone : normalised,
      };
      if (photo) {
        try {
          const uploaded = await deps.account.uploadPhoto({
            uri: photo.uri,
            contentType: photo.contentType,
          });
          change.photoUrl = uploaded.photoUrl;
        } catch (error) {
          // The phone is saved either way; the photo can be added from Profile later (R8.2).
          warn('photo upload', error);
        }
      }
      await deps.authStore
        .updateProfile(change)
        .catch((error: unknown) => warn('save account phone', error));
      await shell.refresh();
    } catch (error) {
      fail(error, t('createAccount.notReachable'));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => (update ? void save() : void create(idToken));

  return (
    <Screen title={title} scroll testID="screen-phone-and-photo">
      <FormField
        label={t('phoneAndPhoto.phone')}
        value={phone}
        onChangeText={(text) => {
          setPhone(text);
          setPhoneError(null);
        }}
        error={phoneError ?? undefined}
        helper={t('createAccount.phoneHelper')}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="done"
        onSubmitEditing={submit}
        editable={!busy}
        testID="phone-photo-phone"
      />
      <PhotoField
        name={name}
        photo={photo}
        onChange={setPhoto}
        modules={deps.photo}
        disabled={busy}
        testID="phone-photo-photo"
      />
      {message ? (
        <AppText
          variant="secondary"
          color="danger"
          accessibilityLiveRegion="polite"
          style={{ marginBottom: tokens.space.md }}
          testID="phone-photo-message"
        >
          {message}
        </AppText>
      ) : null}
      {!update && tokenExpired ? (
        <View style={{ marginBottom: tokens.space.sm }}>
          <SecondaryButton
            label={t('signIn.google')}
            onPress={() => void retryWithGoogle()}
            loading={busy}
            testID="phone-photo-google"
          />
        </View>
      ) : null}
      <View style={{ marginBottom: tokens.space.sm }}>
        <PrimaryButton
          label={update ? t('phoneAndPhoto.save') : t('phoneAndPhoto.submit')}
          onPress={submit}
          loading={busy}
          disabled={!update && tokenExpired}
          testID="phone-photo-submit"
        />
      </View>
      {update ? (
        <DangerButton
          label={t('common.logOut')}
          question={t('common.logOutQuestion')}
          explanation={t('common.logOutExplanation')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => void logout(deps, shell)}
          disabled={busy}
          testID="phone-photo-log-out"
        />
      ) : (
        <TextButton
          label={t('common.back')}
          onPress={() => onBack?.()}
          disabled={busy}
          testID="phone-photo-back"
        />
      )}
    </Screen>
  );
}

/** Where a failed photo upload or store step is reported; neither undoes the saved phone. */
function warn(context: string, error: unknown): void {
  console.warn(`[attendance] ${context}`, error);
}
