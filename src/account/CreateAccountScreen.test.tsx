import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { inferAccountErrorCode } from '../api/accountClient';
import { NotAuthenticated, NotReachable, ServerRefusal } from '../api/transport';
import type { AppDeps } from '../app/deps';
import type { ShellActions } from '../app/useAppState';
import { STRINGS_EN } from '../i18n';
import { base64Encode } from '../signer/base64';
import { AuthStore, type StoredAccount } from '../state/authStore';
import type { SecureStorage } from '../state/pairingStore';
import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed, SCHEMES } from '../../test-support/render';
import { radiusNameOf, tokenNameOf } from '../../test-support/tokens';
import { TOKENS, type ColorScheme } from '../theme';
import { CreateAccountScreen, type CreateAccountScreenProps } from './CreateAccountScreen';
import type { EncodedImage, PhotoModules, PickedImage } from './photo';

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

const PICKED: PickedImage = {
  uri: 'file:///cache/original.jpg',
  width: 1600,
  height: 1600,
  mimeType: 'image/jpeg',
};

function photoModules(): PhotoModules & { pick: ReturnType<typeof vi.fn> } {
  const pick = vi.fn(async () => ({ kind: 'picked' as const, image: PICKED }));
  return {
    pick,
    picker: { pick },
    manipulator: {
      encodeJpeg: vi.fn(
        async (_image: PickedImage, maxSide: number, quality: number): Promise<EncodedImage> => ({
          uri: `file:///cache/encoded-${quality}.jpg`,
          width: maxSide,
          height: maxSide,
          bytes: 120 * 1024,
        }),
      ),
    },
  };
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    base64Encode(new TextEncoder().encode(JSON.stringify(value)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.sig`;
}

function harness(overrides: Partial<CreateAccountScreenProps> = {}, scheme: ColorScheme = 'light') {
  const authStore = new AuthStore({ storage: memoryStorage() });
  const account = {
    createAccount: vi.fn(async () => ACCOUNT),
    uploadPhoto: vi.fn(async () => ({
      photoUrl: '/api/v1/users/u1/photo',
      contentType: 'image/jpeg',
      bytes: 120 * 1024,
      updatedAt: '2025-05-12T09:00:00Z',
    })),
  };
  const googleSignIn = {
    getIdToken: vi.fn(async () => ({
      kind: 'id_token' as const,
      idToken: jwt({ given_name: 'Ramesh', email: 'ramesh@example.in' }),
    })),
  };
  const photo = photoModules();
  // A fresh phone: `completeSignIn` reads the pairing store before storing the account (R9.7).
  const pairingStore = { load: vi.fn(async () => null), wipe: vi.fn(async () => undefined) };
  const deps = { authStore, account, googleSignIn, photo, pairingStore } as unknown as AppDeps;
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn((error: unknown) => error instanceof NotAuthenticated),
    confirm: vi.fn(async () => true),
  };
  const props: CreateAccountScreenProps = {
    deps,
    shell,
    onSignInInstead: vi.fn(),
    onGoogleNeedsPhone: vi.fn(),
    ...overrides,
  };
  renderThemed(<CreateAccountScreen {...props} />, scheme);
  return { authStore, account, googleSignIn, photo, shell, props };
}

function type(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(`${testID}-input`), { target: { value } });
}

function fillValid() {
  type('create-account-name', ' Priya Sharma ');
  type('create-account-email', 'priya@example.in');
  type('create-account-password', 'longenough');
  type('create-account-phone', '+91 98765 43210');
}

describe('CreateAccountScreen (R1.2–R1.5, R1.7, R1.9)', () => {
  it('shows exactly the R1.2 fields, the phone helper, the photo picker and the three actions', () => {
    const h = harness();
    expect(screen.getByRole('heading', { name: STRINGS_EN['createAccount.title'] })).toBeTruthy();
    for (const label of [
      STRINGS_EN['createAccount.fullName'],
      STRINGS_EN['createAccount.email'],
      STRINGS_EN['createAccount.password'],
      STRINGS_EN['createAccount.phone'],
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    // Four inputs and no other field (the password input has no textbox role in the DOM).
    expect(document.querySelectorAll('input')).toHaveLength(4);
    expect(screen.getByTestId('create-account-phone-helper').textContent).toBe(
      STRINGS_EN['createAccount.phoneHelper'],
    );
    expect(screen.getByText(STRINGS_EN['createAccount.photo'])).toBeTruthy();
    expect(screen.getByTestId('create-account-photo-camera')).toBeTruthy();
    expect(screen.getByTestId('create-account-photo-gallery')).toBeTruthy();
    expect(screen.queryByTestId('create-account-photo-remove')).toBeNull();
    expect(screen.getByRole('button', { name: STRINGS_EN['createAccount.submit'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: STRINGS_EN['createAccount.google'] })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: STRINGS_EN['createAccount.signInInstead'] }),
    );
    expect(h.props.onSignInInstead).toHaveBeenCalledTimes(1);
  });

  it.each(SCHEMES)(
    'in %s: the photo picker is a 96 dp avatar in brand on brandSoft with a peach camera badge (textOnAccent glyph), the helper textSecondary, fields 56 dp radius field, Create account a pill, Sign in instead a brand link (R12.14, R12.15)',
    (scheme) => {
      const tokens = TOKENS[scheme];
      harness({}, scheme);
      const preview = screen.getByTestId('create-account-photo-preview');
      expect(styleOf(preview)).toMatchObject({ width: 96, height: 96 });
      expect(tokenNameOf(tokens, styleOf(preview).backgroundColor)).toContain('brandSoft');
      expect(
        tokenNameOf(tokens, styleOf(preview.querySelector('span') as Element).color),
      ).toContain('brand');
      const badge = screen.getByTestId('create-account-photo-badge');
      expect(tokenNameOf(tokens, styleOf(badge).backgroundColor)).toContain('accent');
      expect(styleOf(badge).position).toBe('absolute');
      expect(badge.getAttribute('aria-label')).toBeNull();
      const glyph = styleOf(
        screen.getByTestId('create-account-photo-badge-icon').firstElementChild as Element,
      );
      expect(tokenNameOf(tokens, glyph.borderColor ?? glyph.backgroundColor)).toContain(
        'textOnAccent',
      );
      expect(
        tokenNameOf(tokens, styleOf(screen.getByTestId('create-account-phone-helper')).color),
      ).toContain('textSecondary');
      expect(styleOf(screen.getByTestId('create-account-phone-helper')).fontSize).toBe(14);
      const input = screen.getByTestId('create-account-phone-input');
      expect(styleOf(input).minHeight).toBe(56);
      expect(radiusNameOf(tokens, styleOf(input).borderRadius)).toContain('field');
      expect(tokenNameOf(tokens, styleOf(input).borderColor)).toContain('borderStrong');
      const submit = screen.getByTestId('create-account-submit');
      expect(tokenNameOf(tokens, styleOf(submit).backgroundColor)).toContain('brand');
      expect(radiusNameOf(tokens, styleOf(submit).borderRadius)).toContain('pill');
      expect(
        tokenNameOf(
          tokens,
          styleOf(screen.getByTestId('create-account-sign-in').querySelector('span') as Element)
            .color,
        ),
      ).toContain('brand');
    },
  );

  it('checks every field on the phone first with the R1.2 texts and sends nothing', () => {
    const h = harness();
    type('create-account-name', 'P');
    type('create-account-email', 'priya');
    type('create-account-password', 'short');
    type('create-account-phone', '12345');
    fireEvent.click(screen.getByTestId('create-account-submit'));
    expect(screen.getByTestId('create-account-name-error').textContent).toBe(
      STRINGS_EN['validation.name'],
    );
    expect(screen.getByTestId('create-account-email-error').textContent).toBe(
      STRINGS_EN['validation.email'],
    );
    expect(screen.getByTestId('create-account-password-error').textContent).toBe(
      STRINGS_EN['validation.password'],
    );
    expect(screen.getByTestId('create-account-phone-error').textContent).toBe(
      STRINGS_EN['validation.phone'],
    );
    // The error replaces the helper under the phone field until the worker types again.
    expect(screen.queryByTestId('create-account-phone-helper')).toBeNull();
    type('create-account-phone', '9876543210');
    expect(screen.getByTestId('create-account-phone-helper')).toBeTruthy();
    expect(h.account.createAccount).not.toHaveBeenCalled();
  });

  it('creates the account with the trimmed fields, stores it and re-resolves (R1.5)', async () => {
    const h = harness();
    fillValid();
    fireEvent.click(screen.getByTestId('create-account-submit'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.createAccount).toHaveBeenCalledWith({
      name: 'Priya Sharma',
      email: 'priya@example.in',
      password: 'longenough',
      phone: '+91 98765 43210',
    });
    expect(await h.authStore.account()).toEqual(ACCOUNT);
    expect(h.account.uploadPhoto).not.toHaveBeenCalled();
  });

  it('a chosen photo is cropped, shrunk and uploaded after the account exists (R1.7)', async () => {
    const h = harness();
    fireEvent.click(screen.getByTestId('create-account-photo-gallery'));
    await waitFor(() => expect(screen.getByTestId('create-account-photo-remove')).toBeTruthy());
    expect(h.photo.pick).toHaveBeenCalledWith('library');
    expect(screen.getByTestId('create-account-photo-preview').getAttribute('src')).toBe(
      'file:///cache/encoded-0.85.jpg',
    );

    fillValid();
    fireEvent.click(screen.getByTestId('create-account-submit'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.uploadPhoto).toHaveBeenCalledWith({
      uri: 'file:///cache/encoded-0.85.jpg',
      contentType: 'image/jpeg',
    });
    expect(await h.authStore.profile()).toMatchObject({ photoUrl: '/api/v1/users/u1/photo' });
  });

  it('Remove photo drops the choice; a refused pick says why', async () => {
    const h = harness();
    fireEvent.click(screen.getByTestId('create-account-photo-camera'));
    await waitFor(() => expect(screen.getByTestId('create-account-photo-remove')).toBeTruthy());
    fireEvent.click(screen.getByTestId('create-account-photo-remove'));
    expect(screen.queryByTestId('create-account-photo-remove')).toBeNull();

    h.photo.pick.mockResolvedValueOnce({
      kind: 'picked',
      image: { ...PICKED, mimeType: 'image/gif' },
    } as never);
    fireEvent.click(screen.getByTestId('create-account-photo-gallery'));
    await waitFor(() =>
      expect(screen.getByTestId('create-account-photo-error').textContent).toBe(
        STRINGS_EN['photo.unsupported'],
      ),
    );
    h.photo.pick.mockResolvedValueOnce({ kind: 'denied' } as never);
    fireEvent.click(screen.getByTestId('create-account-photo-camera'));
    await waitFor(() =>
      expect(screen.getByTestId('create-account-photo-error').textContent).toBe(
        STRINGS_EN['photo.denied'],
      ),
    );
  });

  it('not reachable: the R1.9 line, nothing stored on the phone', async () => {
    const h = harness();
    h.account.createAccount.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    fillValid();
    fireEvent.click(screen.getByTestId('create-account-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('create-account-message').textContent).toBe(
        STRINGS_EN['createAccount.notReachable'],
      ),
    );
    expect(await h.authStore.accessToken()).toBeNull();
    expect(await h.authStore.profile()).toBeNull();
    expect(h.shell.refresh).not.toHaveBeenCalled();
  });

  it('a duplicate e-mail is the server’s sentence word for word', async () => {
    const h = harness();
    h.account.createAccount.mockRejectedValueOnce(
      new ServerRefusal(
        409,
        'An account with this email already exists. Sign in instead.',
        inferAccountErrorCode,
      ),
    );
    fillValid();
    fireEvent.click(screen.getByTestId('create-account-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('create-account-message').textContent).toBe(
        'An account with this email already exists. Sign in instead.',
      ),
    );
  });

  it('Continue with Google hands the ID token and the first name to the phone step (R1.4)', async () => {
    const h = harness();
    fireEvent.click(screen.getByTestId('create-account-google'));
    await waitFor(() => expect(h.props.onGoogleNeedsPhone).toHaveBeenCalledTimes(1));
    expect(h.props.onGoogleNeedsPhone).toHaveBeenCalledWith({
      mode: 'signup',
      idToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.sig$/),
      name: 'Ramesh',
      email: 'ramesh@example.in',
    });
    // No account is created from this screen on the Google path.
    expect(h.account.createAccount).not.toHaveBeenCalled();
    expect(await h.authStore.accessToken()).toBeNull();
  });
});
