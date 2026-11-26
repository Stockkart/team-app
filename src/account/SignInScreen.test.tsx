import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OAUTH_ACCOUNT_NOT_FOUND } from '@stockkart/attendance-protocol';

import { inferAccountErrorCode } from '../api/accountClient';
import { NotAuthenticated, NotReachable, ServerRefusal } from '../api/transport';
import type { AppDeps } from '../app/deps';
import type { ShellActions } from '../app/useAppState';
import { FORGOT_PASSWORD_URL } from '../config';
import { STRINGS_EN } from '../i18n';
import { base64Encode } from '../signer/base64';
import { AuthStore, type StoredAccount } from '../state/authStore';
import type { PairingRecord, SecureStorage } from '../state/pairingStore';
import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS, type ColorScheme } from '../theme';
import { SignInScreen, type SignInScreenProps } from './SignInScreen';

// `Screen` reads the safe area from react-native-safe-area-context, a native module.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// `AuthStore` shares its secure-store adapter with `pairingStore`, which binds expo-secure-store and
// expo-crypto at module load; the tests inject memory storage instead.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

afterEach(cleanup);

function memoryStorage(): SecureStorage {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async deleteItem(key) {
      map.delete(key);
    },
  };
}

const ACCOUNT: StoredAccount = {
  userId: 'u1',
  name: 'Priya Sharma',
  email: 'priya@example.in',
  phone: '9876543210',
  role: 'WORKER',
  accessToken: 'tok',
};

/** An unsigned JWT with `payload`: what `nameFromIdToken` / `emailFromIdToken` read (display only). */
function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    base64Encode(new TextEncoder().encode(JSON.stringify(value)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.sig`;
}

const GOOGLE_TOKEN = jwt({
  given_name: 'Ramesh',
  name: 'Ramesh Kumar',
  email: 'ramesh@example.in',
});

function harness(overrides: Partial<SignInScreenProps> = {}, scheme: ColorScheme = 'light') {
  const authStore = new AuthStore({ storage: memoryStorage() });
  const account = {
    signIn: vi.fn(async () => ACCOUNT),
    signInWithGoogle: vi.fn(async () => ACCOUNT),
    uploadPhoto: vi.fn(),
  };
  const googleSignIn = {
    getIdToken: vi.fn(async () => ({ kind: 'id_token' as const, idToken: GOOGLE_TOKEN })),
  };
  const openUrl = vi.fn(async () => undefined);
  const pairingStore = {
    load: vi.fn<() => Promise<PairingRecord | null>>(async () => null),
    wipe: vi.fn(async () => undefined),
  };
  const client = { unpairMe: vi.fn(async () => ({ unpaired: true })) };
  const queue = { waitingCount: vi.fn(async () => 0) };
  const deps = {
    authStore,
    account,
    googleSignIn,
    openUrl,
    pairingStore,
    client,
    queue,
  } as unknown as AppDeps;
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn((error: unknown) => error instanceof NotAuthenticated),
    confirm: vi.fn(async () => true),
  };
  const props: SignInScreenProps = {
    deps,
    shell,
    sessionEnded: false,
    onCreateAccount: vi.fn(),
    onGoogleNeedsSignup: vi.fn(),
    ...overrides,
  };
  renderThemed(<SignInScreen {...props} />, scheme);
  return { authStore, account, googleSignIn, openUrl, pairingStore, client, queue, shell, props };
}

const PAIRING: PairingRecord = {
  pairingId: '66f1a2b3c4d5e6f708192a3c',
  shopId: '5f1a2b3c4d5e6f7081920001',
  employeeId: '5f1a2b3c4d5e6f7081920002',
  employeeName: 'Ravi Kumar',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: false },
  consentVersion: 1,
};

function type(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(`${testID}-input`), { target: { value } });
}

describe('SignInScreen (R1.1, R1.6, R9.3)', () => {
  it('offers Sign in, Google, Forgot password and Create account, and nothing else (R1.1)', () => {
    const h = harness();
    expect(screen.getByRole('heading', { name: STRINGS_EN['common.appName'] })).toBeTruthy();
    expect(screen.getByLabelText(STRINGS_EN['signIn.email'])).toBeTruthy();
    expect(screen.getByLabelText(STRINGS_EN['signIn.password'])).toBeTruthy();
    expect(screen.getByRole('button', { name: STRINGS_EN['signIn.submit'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: STRINGS_EN['signIn.google'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: STRINGS_EN['signIn.forgotPassword'] })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: STRINGS_EN['signIn.createAccount'] }));
    expect(h.props.onCreateAccount).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('sign-in-session-ended')).toBeNull();
    // The whole control set: no "continue without account" path (R1.1).
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      STRINGS_EN['signIn.submit'],
      STRINGS_EN['signIn.google'],
      STRINGS_EN['signIn.forgotPassword'],
      STRINGS_EN['signIn.createAccount'],
    ]);
    // Exactly one primary button (R12.5).
    expect(screen.getByTestId('sign-in-submit')).toBeTruthy();
  });

  it('a stored pairing changes nothing on this screen (R1.1, D11)', () => {
    const h = harness();
    h.pairingStore.load.mockResolvedValue(PAIRING);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByText(/check in/i)).toBeNull();
  });

  it('after the session ended: the R9.3 line', () => {
    harness({ sessionEnded: true });
    expect(screen.getByText(STRINGS_EN['signIn.sessionEnded'])).toBeTruthy();
  });

  it.each(SCHEMES)(
    'in %s: the app mark (brand disc, accent dot), the session-ended line as a warning card, a pill primary button, an outlined Google button, links in brand (R12.14, R12.15)',
    (scheme) => {
      const tokens = TOKENS[scheme];
      harness({ sessionEnded: true }, scheme);
      const mark = screen.getByTestId('sign-in-mark');
      expect(tokenNameOf(tokens, styleOf(mark).backgroundColor)).toContain('brand');
      expect(
        tokenNameOf(tokens, styleOf(screen.getByTestId('sign-in-mark-dot')).backgroundColor),
      ).toContain('accent');
      expect(mark.getAttribute('aria-label')).toBeNull();

      const card = screen.getByTestId('sign-in-session-ended');
      expect(tokenNameOf(tokens, styleOf(card).backgroundColor)).toContain('warningSoft');
      expect(radiusNameOf(tokens, styleOf(card).borderRadius)).toContain('card');
      expect(tokenNameOf(tokens, styleOf(card.querySelector('span') as Element).color)).toContain(
        'textPrimary',
      );

      const submit = screen.getByTestId('sign-in-submit');
      expect(tokenNameOf(tokens, styleOf(submit).backgroundColor)).toContain('brand');
      expect(radiusNameOf(tokens, styleOf(submit).borderRadius)).toContain('pill');
      const google = screen.getByTestId('sign-in-google');
      expect(tokenNameOf(tokens, styleOf(google).borderColor)).toContain('borderStrong');
      expect(radiusNameOf(tokens, styleOf(google).borderRadius)).toContain('pill');

      for (const id of ['sign-in-forgot', 'sign-in-create']) {
        const link = screen.getByTestId(id);
        expect(tokenNameOf(tokens, styleOf(link.querySelector('span') as Element).color)).toContain(
          'brand',
        );
        expect(styleOf(link).backgroundColor).toBeUndefined();
      }
      const email = screen.getByTestId('sign-in-email-input');
      expect(styleOf(email).minHeight).toBe(56);
      expect(radiusNameOf(tokens, styleOf(email).borderRadius)).toContain('field');
    },
  );

  it('checks the fields on the phone first and sends nothing while they fail', () => {
    const h = harness();
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    expect(screen.getByTestId('sign-in-email-error').textContent).toBe(
      STRINGS_EN['validation.email'],
    );
    expect(screen.getByTestId('sign-in-password-error').textContent).toBe(
      STRINGS_EN['validation.password'],
    );
    expect(h.account.signIn).not.toHaveBeenCalled();
    // Typing clears the field's error.
    type('sign-in-email', 'priya@example.in');
    expect(screen.queryByTestId('sign-in-email-error')).toBeNull();
  });

  it('a successful sign-in stores the account and re-resolves the shell (R1.6)', async () => {
    const h = harness();
    type('sign-in-email', ' priya@example.in ');
    type('sign-in-password', 'secret-pw');
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.signIn).toHaveBeenCalledWith({
      email: 'priya@example.in',
      password: 'secret-pw',
    });
    expect(await h.authStore.account()).toEqual(ACCOUNT);
    expect(screen.queryByTestId('sign-in-message')).toBeNull();
  });

  it('a wrong password is shown word for word and nothing is stored', async () => {
    const h = harness();
    h.account.signIn.mockRejectedValueOnce(
      new ServerRefusal(401, 'Invalid email or password', inferAccountErrorCode),
    );
    type('sign-in-email', 'priya@example.in');
    type('sign-in-password', 'wrong');
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('sign-in-message').textContent).toBe('Invalid email or password'),
    );
    expect(await h.authStore.accessToken()).toBeNull();
    expect(h.shell.refresh).not.toHaveBeenCalled();
  });

  it('not reachable: one line, nothing stored', async () => {
    const h = harness();
    h.account.signIn.mockRejectedValueOnce(new NotReachable('TIMEOUT'));
    type('sign-in-email', 'priya@example.in');
    type('sign-in-password', 'secret-pw');
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('sign-in-message').textContent).toBe(
        STRINGS_EN['signIn.notReachable'],
      ),
    );
    expect(await h.authStore.accessToken()).toBeNull();
  });

  it('Continue with Google: the ID token goes to the server, the account is stored', async () => {
    const h = harness();
    fireEvent.click(screen.getByTestId('sign-in-google'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.signInWithGoogle).toHaveBeenCalledWith(GOOGLE_TOKEN);
    expect(await h.authStore.account()).toEqual(ACCOUNT);
    expect(h.props.onGoogleNeedsSignup).not.toHaveBeenCalled();
  });

  it('Google with no Stockkart account (OAUTH_ACCOUNT_NOT_FOUND): the phone step opens with the same token, its name and e-mail; the sentence is never shown, nothing is stored (R1.10, R1.13)', async () => {
    const h = harness();
    h.account.signInWithGoogle.mockRejectedValueOnce(
      new ServerRefusal(401, OAUTH_ACCOUNT_NOT_FOUND, inferAccountErrorCode),
    );
    fireEvent.click(screen.getByTestId('sign-in-google'));
    await waitFor(() => expect(h.props.onGoogleNeedsSignup).toHaveBeenCalledTimes(1));
    expect(h.props.onGoogleNeedsSignup).toHaveBeenCalledWith({
      mode: 'signup',
      idToken: GOOGLE_TOKEN,
      name: 'Ramesh',
      email: 'ramesh@example.in',
    });
    // No text of the refusal, no generic line, no session, no re-resolve.
    expect(screen.queryByTestId('sign-in-message')).toBeNull();
    expect(screen.queryByText(/sign up first/i)).toBeNull();
    expect(await h.authStore.accessToken()).toBeNull();
    expect(await h.authStore.profile()).toBeNull();
    expect(h.shell.refresh).not.toHaveBeenCalled();
    // The screen is usable again (the token is only in the params handed over).
    await waitFor(() =>
      expect((screen.getByTestId('sign-in-google') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('Google with no Stockkart account and a token without name claims: empty name and e-mail, still the phone step', async () => {
    const h = harness();
    h.googleSignIn.getIdToken.mockResolvedValueOnce({ kind: 'id_token', idToken: 'opaque' });
    h.account.signInWithGoogle.mockRejectedValueOnce(
      new ServerRefusal(401, OAUTH_ACCOUNT_NOT_FOUND, inferAccountErrorCode),
    );
    fireEvent.click(screen.getByTestId('sign-in-google'));
    await waitFor(() => expect(h.props.onGoogleNeedsSignup).toHaveBeenCalledTimes(1));
    expect(h.props.onGoogleNeedsSignup).toHaveBeenCalledWith({
      mode: 'signup',
      idToken: 'opaque',
      name: '',
      email: '',
    });
  });

  it('Google refused with INVALID_CREDENTIALS (wrong audience) or ACCOUNT_DISABLED: the text word for word, no phone step', async () => {
    const h = harness();
    h.account.signInWithGoogle.mockRejectedValueOnce(
      new ServerRefusal(401, 'Invalid credentials', inferAccountErrorCode),
    );
    fireEvent.click(screen.getByTestId('sign-in-google'));
    await waitFor(() =>
      expect(screen.getByTestId('sign-in-message').textContent).toBe('Invalid credentials'),
    );
    expect(h.props.onGoogleNeedsSignup).not.toHaveBeenCalled();
    expect(await h.authStore.accessToken()).toBeNull();

    h.account.signInWithGoogle.mockRejectedValueOnce(
      new ServerRefusal(401, 'Account is deactivated', inferAccountErrorCode),
    );
    fireEvent.click(screen.getByTestId('sign-in-google'));
    await waitFor(() =>
      expect(screen.getByTestId('sign-in-message').textContent).toBe('Account is deactivated'),
    );
    expect(h.props.onGoogleNeedsSignup).not.toHaveBeenCalled();
    expect(h.shell.refresh).not.toHaveBeenCalled();
  });

  it('Google cancelled → nothing; unavailable → a line offering e-mail and password', async () => {
    const h = harness();
    h.googleSignIn.getIdToken.mockResolvedValueOnce({ kind: 'cancelled' } as never);
    fireEvent.click(screen.getByTestId('sign-in-google'));
    await waitFor(() => expect(h.googleSignIn.getIdToken).toHaveBeenCalledTimes(1));
    expect(h.account.signInWithGoogle).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sign-in-message')).toBeNull();
    // The handler releases the button asynchronously; a second tap only counts once it is live.
    await waitFor(() =>
      expect((screen.getByTestId('sign-in-google') as HTMLButtonElement).disabled).toBe(false),
    );

    h.googleSignIn.getIdToken.mockResolvedValueOnce({ kind: 'unavailable' } as never);
    fireEvent.click(screen.getByTestId('sign-in-google'));
    await waitFor(() =>
      expect(screen.getByTestId('sign-in-message').textContent).toBe(
        STRINGS_EN['signIn.googleUnavailable'],
      ),
    );
    expect(h.account.signInWithGoogle).not.toHaveBeenCalled();
  });

  it('another account than the pairing\u2019s owner: the R9.7 question first; cancel stores nothing (R9.7)', async () => {
    const h = harness({ sessionEnded: true });
    // Ravi paired this phone and his session ended; Priya signs in.
    await h.authStore.saveAccount({ ...ACCOUNT, userId: 'u2', name: 'Ravi Kumar' });
    await h.authStore.setPairingOwnerUserId('u2');
    await h.authStore.clearSession();
    h.pairingStore.load.mockResolvedValue(PAIRING);
    h.queue.waitingCount.mockResolvedValue(3);
    (h.shell.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    type('sign-in-email', 'priya@example.in');
    type('sign-in-password', 'secret-pw');
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(h.shell.confirm).toHaveBeenCalledTimes(1));
    expect((h.shell.confirm as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      question: STRINGS_EN['switchAccount.question'],
      explanation: expect.stringContaining('3 punches that were not yet sent will be lost'),
    });
    // Cancelled: no unpair, no wipe, nothing stored, no re-resolve; the form stays usable.
    expect(h.client.unpairMe).not.toHaveBeenCalled();
    expect(h.pairingStore.wipe).not.toHaveBeenCalled();
    expect(await h.authStore.accessToken()).toBeNull();
    expect(await h.authStore.profile()).toMatchObject({ userId: 'u2' });
    expect(h.shell.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId('sign-in-submit')).toBeTruthy();

    // Confirmed: unpair once, wipe, store, re-resolve.
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.client.unpairMe).toHaveBeenCalledTimes(1);
    expect(h.pairingStore.wipe).toHaveBeenCalledTimes(1);
    expect(await h.authStore.account()).toEqual(ACCOUNT);
  });

  it('Forgot password? opens the web reset page in the browser', () => {
    const h = harness();
    fireEvent.click(screen.getByTestId('sign-in-forgot'));
    expect(h.openUrl).toHaveBeenCalledWith(FORGOT_PASSWORD_URL);
    expect(FORGOT_PASSWORD_URL).toBe('https://api.test.invalid/forgot-password');
  });
});
