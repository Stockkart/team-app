/**
 * Sign in (worker-app R1.1, R1.6, R9.3; design "Screen inventory": Sign in). Top to bottom: the
 * app mark (a violet circle with a peach dot, `AppMark`) and the app's name as the title; when the
 * session ended the R9.3 line ("Your session ended. Sign in again.") as a warning `StatusCard`;
 * e-mail; password; **Sign in** (the pill primary button); "Continue with Google" (secondary; when
 * the server answers `OAUTH_ACCOUNT_NOT_FOUND` it opens the phone step instead of showing the text,
 * R1.10); "Forgot password?" (a `brand` link that opens the web's reset page in the browser);
 * "Create account" (a `brand` link). Nothing else is reachable before one of them completes
 * (R1.1): a pairing stored on the phone changes nothing on this screen.
 *
 * Both sign-ins call the web's endpoints through `AccountClient` (R1.6). A wrong password or a
 * deactivated account is a refusal shown word for word; "not reachable" is said in one line;
 * nothing is stored until the server has answered with a token (`completeSignIn`). The fields are
 * checked on the phone first (e-mail shape, a password typed) so an obviously incomplete form never
 * leaves the phone.
 *
 * **Google without a Stockkart account** (R1.10, DD20): when the server answers
 * `OAUTH_ACCOUNT_NOT_FOUND`, the worker never sees "sign up first". The screen hands the same ID
 * token, with the name and e-mail read from it for display, to `onGoogleNeedsSignup`, and the
 * navigator opens the phone step in `signup` mode, which creates the WORKER account from it
 * (R1.4's rules). The token travels as a route param only; nothing is stored here (R1.13).
 *
 * No `expo-*` import: Google, the browser and the store come in through `deps`.
 */
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppMark,
  AppText,
  FormField,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StatusCard,
  TextButton,
} from '../components';
import type { ShellScreenProps } from '../app/screenProps';
import { isServerRefusal } from '../api/transport';
import { FORGOT_PASSWORD_URL } from '../config';
import { t, type StringId } from '../i18n';
import type { PhoneAndPhotoParams } from '../navigation/routes';
import { useTheme } from '../theme';
import { accountErrorText, completeSignIn, emailFromIdToken, nameFromIdToken } from './session';
import { signInErrors } from './validation';

export interface SignInScreenProps extends ShellScreenProps {
  /** The token was cleared because the server said the session ended: the R9.3 line is shown. */
  sessionEnded: boolean;
  onCreateAccount: () => void;
  /**
   * Google succeeded but no Stockkart account exists for it (`OAUTH_ACCOUNT_NOT_FOUND`, R1.10):
   * open the phone step in `signup` mode with the same ID token.
   */
  onGoogleNeedsSignup: (params: PhoneAndPhotoParams) => void;
}

type Busy = 'password' | 'google' | null;

export function SignInScreen({
  deps,
  shell,
  sessionEnded,
  onCreateAccount,
  onGoogleNeedsSignup,
}: SignInScreenProps) {
  const { tokens } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'email' | 'password', StringId>>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);

  const finish = (error: unknown) => {
    if (shell.handleError(error)) {
      return;
    }
    setMessage(accountErrorText(error, t('signIn.notReachable')));
  };

  const signInWithPassword = async () => {
    if (busy) {
      return;
    }
    const fields = { email: email.trim(), password };
    const found = signInErrors(fields);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setMessage(null);
    setBusy('password');
    try {
      const account = await deps.account.signIn(fields);
      await completeSignIn(deps, shell, account);
    } catch (error) {
      finish(error);
    } finally {
      setBusy(null);
    }
  };

  const signInWithGoogle = async () => {
    if (busy) {
      return;
    }
    setMessage(null);
    setBusy('google');
    let idToken: string | null = null;
    try {
      const result = await deps.googleSignIn.getIdToken();
      if (result.kind === 'cancelled') {
        return;
      }
      if (result.kind === 'unavailable') {
        setMessage(t('signIn.googleUnavailable'));
        return;
      }
      idToken = result.idToken;
      const account = await deps.account.signInWithGoogle(idToken);
      await completeSignIn(deps, shell, account);
    } catch (error) {
      if (idToken != null && isServerRefusal(error) && error.code === 'OAUTH_ACCOUNT_NOT_FOUND') {
        // No Stockkart account for this Google account: the phone step creates one from the same
        // token (R1.10). The server's sentence is never shown.
        onGoogleNeedsSignup({
          mode: 'signup',
          idToken,
          name: nameFromIdToken(idToken) ?? '',
          email: emailFromIdToken(idToken) ?? '',
        });
        return;
      }
      finish(error);
    } finally {
      setBusy(null);
    }
  };

  const inactive = busy !== null;

  return (
    <Screen scroll testID="screen-sign-in">
      <View
        style={{ alignItems: 'center', marginTop: tokens.space.lg, marginBottom: tokens.space.lg }}
      >
        <AppMark testID="sign-in-mark" />
        <AppText
          variant="title"
          accessibilityRole="header"
          align="center"
          style={{ marginTop: tokens.space.md }}
        >
          {t('common.appName')}
        </AppText>
      </View>
      {sessionEnded ? (
        <View style={{ marginBottom: tokens.space.md }}>
          <StatusCard
            title={t('signIn.sessionEnded')}
            tone="warning"
            testID="sign-in-session-ended"
          />
        </View>
      ) : null}
      <FormField
        label={t('signIn.email')}
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setErrors((current) => ({ ...current, email: undefined }));
        }}
        error={errors.email ? t(errors.email) : undefined}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        textContentType="emailAddress"
        returnKeyType="next"
        editable={!inactive}
        testID="sign-in-email"
      />
      <FormField
        label={t('signIn.password')}
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setErrors((current) => ({ ...current, password: undefined }));
        }}
        error={errors.password ? t(errors.password) : undefined}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={() => void signInWithPassword()}
        editable={!inactive}
        testID="sign-in-password"
      />
      {message ? (
        <AppText
          variant="secondary"
          color="danger"
          accessibilityLiveRegion="polite"
          style={{ marginBottom: tokens.space.md }}
          testID="sign-in-message"
        >
          {message}
        </AppText>
      ) : null}
      <View style={{ marginBottom: tokens.space.sm }}>
        <PrimaryButton
          label={t('signIn.submit')}
          onPress={() => void signInWithPassword()}
          loading={busy === 'password'}
          disabled={busy === 'google'}
          testID="sign-in-submit"
        />
      </View>
      <View style={{ marginBottom: tokens.space.sm }}>
        <SecondaryButton
          label={t('signIn.google')}
          onPress={() => void signInWithGoogle()}
          loading={busy === 'google'}
          disabled={busy === 'password'}
          testID="sign-in-google"
        />
      </View>
      <TextButton
        link
        label={t('signIn.forgotPassword')}
        onPress={() => void deps.openUrl(FORGOT_PASSWORD_URL).catch(() => undefined)}
        disabled={inactive}
        testID="sign-in-forgot"
      />
      <TextButton
        link
        label={t('signIn.createAccount')}
        onPress={onCreateAccount}
        disabled={inactive}
        testID="sign-in-create"
      />
    </Screen>
  );
}
