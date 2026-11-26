/**
 * Create account (worker-app R1.2–R1.5, R1.7, R1.9; design "Screen inventory": Create account).
 * Exactly these fields: full name, e-mail, password, phone number with the helper "We'll use this
 * number for your shop to contact you" (the number is not verified, R1.3; helper in
 * `textSecondary` 14 sp under the field), and an optional square-cropped photo (`PhotoField`: a
 * 96 dp avatar on `brandSoft` with a peach camera badge). Then **Create account** (the pill
 * primary button), "Continue with Google" (secondary) and "Sign in instead" (a `brand` link).
 *
 * The fields are checked on the phone first with the backend's own rules (`validation.ts`: name
 * 2–100, a valid e-mail, a password of 8+, a 10-digit Indian mobile) and the server second; a
 * refusal ("An account with this email already exists. Sign in instead.") is shown word for word.
 * While the server is not reachable the screen says "Couldn't reach Stockkart. Check your
 * connection and try again." and stores nothing (R1.9): the account and the photo reach the phone
 * only through `completeSignIn`, after the server has answered with a token. The account is created
 * with role `WORKER` and `source: worker-app` by `AccountClient.createAccount` (R1.5, R1.8).
 *
 * "Continue with Google" here only fetches the ID token; the phone number is still required, so the
 * token goes to the `PhoneAndPhoto` screen, which creates the account (R1.4).
 */
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppText,
  FormField,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextButton,
} from '../components';
import type { ShellScreenProps } from '../app/screenProps';
import { t, type StringId } from '../i18n';
import type { PhoneAndPhotoParams } from '../navigation/routes';
import { useTheme } from '../theme';
import { PhotoField } from './PhotoField';
import type { PreparedPhoto } from './photo';
import { accountErrorText, completeSignIn, emailFromIdToken, nameFromIdToken } from './session';
import { createAccountErrors, type CreateAccountFields } from './validation';

export interface CreateAccountScreenProps extends ShellScreenProps {
  onSignInInstead: () => void;
  /** Google gave an ID token but the account needs a phone first (R1.4). */
  onGoogleNeedsPhone: (params: PhoneAndPhotoParams) => void;
}

type Busy = 'password' | 'google' | null;
type Errors = Partial<Record<keyof CreateAccountFields, StringId>>;

export function CreateAccountScreen({
  deps,
  shell,
  onSignInInstead,
  onGoogleNeedsPhone,
}: CreateAccountScreenProps) {
  const { tokens } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);

  const clearError = (field: keyof CreateAccountFields) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  const finish = (error: unknown) => {
    if (shell.handleError(error)) {
      return;
    }
    setMessage(accountErrorText(error, t('createAccount.notReachable')));
  };

  const create = async () => {
    if (busy) {
      return;
    }
    const fields: CreateAccountFields = {
      name: name.trim(),
      email: email.trim(),
      password,
      phone: phone.trim(),
    };
    const found = createAccountErrors(fields);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setMessage(null);
    setBusy('password');
    try {
      const account = await deps.account.createAccount(fields);
      await completeSignIn(deps, shell, account, photo);
    } catch (error) {
      finish(error);
    } finally {
      setBusy(null);
    }
  };

  const withGoogle = async () => {
    if (busy) {
      return;
    }
    setMessage(null);
    setBusy('google');
    try {
      const result = await deps.googleSignIn.getIdToken();
      if (result.kind === 'cancelled') {
        return;
      }
      if (result.kind === 'unavailable') {
        setMessage(t('signIn.googleUnavailable'));
        return;
      }
      onGoogleNeedsPhone({
        mode: 'signup',
        idToken: result.idToken,
        name: nameFromIdToken(result.idToken) ?? '',
        email: emailFromIdToken(result.idToken) ?? '',
      });
    } catch (error) {
      finish(error);
    } finally {
      setBusy(null);
    }
  };

  const inactive = busy !== null;

  return (
    <Screen title={t('createAccount.title')} scroll testID="screen-create-account">
      <FormField
        label={t('createAccount.fullName')}
        value={name}
        onChangeText={(text) => {
          setName(text);
          clearError('name');
        }}
        error={errors.name ? t(errors.name) : undefined}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        editable={!inactive}
        testID="create-account-name"
      />
      <FormField
        label={t('createAccount.email')}
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          clearError('email');
        }}
        error={errors.email ? t(errors.email) : undefined}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        textContentType="emailAddress"
        returnKeyType="next"
        editable={!inactive}
        testID="create-account-email"
      />
      <FormField
        label={t('createAccount.password')}
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          clearError('password');
        }}
        error={errors.password ? t(errors.password) : undefined}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        editable={!inactive}
        testID="create-account-password"
      />
      <FormField
        label={t('createAccount.phone')}
        value={phone}
        onChangeText={(text) => {
          setPhone(text);
          clearError('phone');
        }}
        error={errors.phone ? t(errors.phone) : undefined}
        helper={t('createAccount.phoneHelper')}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="done"
        editable={!inactive}
        testID="create-account-phone"
      />
      <PhotoField
        name={name}
        photo={photo}
        onChange={setPhoto}
        modules={deps.photo}
        disabled={inactive}
        testID="create-account-photo"
      />
      {message ? (
        <AppText
          variant="secondary"
          color="danger"
          accessibilityLiveRegion="polite"
          style={{ marginBottom: tokens.space.md }}
          testID="create-account-message"
        >
          {message}
        </AppText>
      ) : null}
      <View style={{ marginBottom: tokens.space.sm }}>
        <PrimaryButton
          label={t('createAccount.submit')}
          onPress={() => void create()}
          loading={busy === 'password'}
          disabled={busy === 'google'}
          testID="create-account-submit"
        />
      </View>
      <View style={{ marginBottom: tokens.space.sm }}>
        <SecondaryButton
          label={t('createAccount.google')}
          onPress={() => void withGoogle()}
          loading={busy === 'google'}
          disabled={busy === 'password'}
          testID="create-account-google"
        />
      </View>
      <TextButton
        link
        label={t('createAccount.signInInstead')}
        onPress={onSignInInstead}
        disabled={inactive}
        testID="create-account-sign-in"
      />
    </Screen>
  );
}
