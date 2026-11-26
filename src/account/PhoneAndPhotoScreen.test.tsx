import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { inferAccountErrorCode } from '../api/accountClient';
import { NotAuthenticated, NotReachable, ServerRefusal } from '../api/transport';
import type { AppDeps } from '../app/deps';
import type { ShellActions } from '../app/useAppState';
import { STRINGS_EN } from '../i18n';
import type { PhoneAndPhotoParams } from '../navigation/routes';
import { AuthStore, type StoredAccount } from '../state/authStore';
import type { SecureStorage } from '../state/pairingStore';
import { styleOf } from '../../test-support/react-native-dom';
import { renderThemed } from '../../test-support/render';
import { tokenNameOf } from '../../test-support/tokens';
import { TOKENS } from '../theme';
import { PhoneAndPhotoScreen, type PhoneAndPhotoScreenProps } from './PhoneAndPhotoScreen';
import type { PhotoModules, PickedImage } from './photo';

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
  userId: 'u2',
  name: 'Ramesh Kumar',
  email: 'ramesh@example.in',
  phone: '9876543210',
  role: 'WORKER',
  accessToken: 'tok',
};

/** A signed-in account stored without a phone: what the `update` mode completes (R1.11). */
const NO_PHONE: StoredAccount = {
  userId: 'u3',
  name: 'Anita Desai',
  email: 'anita@example.in',
  role: 'MANAGER',
  accessToken: 'tok-3',
};

const SIGNUP: PhoneAndPhotoParams = {
  mode: 'signup',
  idToken: 'google-id-token',
  name: 'Ramesh',
  email: 'ramesh@example.in',
};
const UPDATE: PhoneAndPhotoParams = { mode: 'update' };

const PICKED: PickedImage = { uri: 'file:///cache/o.jpg', width: 800, height: 800 };

const UPLOADED = {
  photoUrl: '/api/v1/users/u2/photo',
  contentType: 'image/jpeg',
  bytes: 90 * 1024,
  updatedAt: '2025-05-12T09:00:00Z',
};

function harness(overrides: Partial<PhoneAndPhotoScreenProps> = {}) {
  const authStore = new AuthStore({ storage: memoryStorage() });
  const account = {
    createAccountWithGoogle: vi.fn(async () => ACCOUNT),
    updateAccountProfile: vi.fn(async (request: { phone: string }) => ({
      userId: NO_PHONE.userId,
      role: NO_PHONE.role,
      email: NO_PHONE.email,
      name: NO_PHONE.name,
      phone: request.phone,
    })),
    uploadPhoto: vi.fn(async () => UPLOADED),
    logout: vi.fn(async () => ({ success: true })),
  };
  const googleSignIn = {
    getIdToken: vi.fn(async () => ({ kind: 'id_token' as const, idToken: 'fresh-id-token' })),
  };
  const photo: PhotoModules = {
    picker: { pick: vi.fn(async () => ({ kind: 'picked' as const, image: PICKED })) },
    manipulator: {
      encodeJpeg: vi.fn(async (_image, maxSide: number, quality: number) => ({
        uri: `file:///cache/e-${quality}.jpg`,
        width: maxSide,
        height: maxSide,
        bytes: 90 * 1024,
      })),
    },
  };
  // A fresh phone: `completeSignIn` reads the pairing store before storing the account (R9.7).
  const pairingStore = { load: vi.fn(async () => null), wipe: vi.fn(async () => undefined) };
  const deps = {
    authStore,
    account,
    googleSignIn,
    photo,
    pairingStore,
  } as unknown as AppDeps;
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn((error: unknown) => error instanceof NotAuthenticated),
    confirm: vi.fn(async () => true),
  };
  const props: PhoneAndPhotoScreenProps = {
    deps,
    shell,
    params: SIGNUP,
    onBack: vi.fn(),
    ...overrides,
  };
  return {
    authStore,
    account,
    googleSignIn,
    shell,
    props,
    render: () => renderThemed(<PhoneAndPhotoScreen {...props} />),
  };
}

function signup(overrides: Partial<PhoneAndPhotoScreenProps> = {}) {
  const h = harness(overrides);
  h.render();
  return h;
}

/** `update` mode over an account stored without a phone, the way the `NeedsPhone` group mounts it. */
async function update(overrides: Partial<PhoneAndPhotoScreenProps> = {}) {
  const h = harness({ params: UPDATE, onBack: undefined, profile: NO_PHONE, ...overrides });
  await h.authStore.saveAccount(NO_PHONE);
  h.render();
  return h;
}

function typePhone(value: string) {
  fireEvent.change(screen.getByTestId('phone-photo-phone-input'), { target: { value } });
}

async function pickPhoto() {
  fireEvent.click(screen.getByTestId('phone-photo-photo-gallery'));
  await waitFor(() => expect(screen.getByTestId('phone-photo-photo-remove')).toBeTruthy());
}

function buttons(): (string | null)[] {
  return screen.getAllByRole('button').map((b) => b.textContent);
}

describe('PhoneAndPhotoScreen, signup mode (R1.4, R1.10, R1.13)', () => {
  it('greets by first name, asks for the phone with the helper, offers the photo, Create account and Back; no Log out', () => {
    const h = signup();
    expect(screen.getByRole('heading', { name: 'Almost done, Ramesh' })).toBeTruthy();
    expect(screen.getByLabelText(STRINGS_EN['phoneAndPhoto.phone'])).toBeTruthy();
    expect(screen.getByTestId('phone-photo-phone-helper').textContent).toBe(
      STRINGS_EN['createAccount.phoneHelper'],
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByTestId('phone-photo-photo-camera')).toBeTruthy();
    expect(screen.getByRole('button', { name: STRINGS_EN['phoneAndPhoto.submit'] })).toBeTruthy();
    expect(screen.queryByTestId('phone-photo-log-out')).toBeNull();
    expect(screen.queryByTestId('phone-photo-google')).toBeNull();
    expect(screen.queryByText(STRINGS_EN['phoneAndPhoto.updateTitle'])).toBeNull();
    fireEvent.click(screen.getByTestId('phone-photo-back'));
    expect(h.props.onBack).toHaveBeenCalledTimes(1);
  });

  it('draws the photo picker as Create account does: a 96 dp avatar on brandSoft with the peach camera badge', () => {
    signup();
    const tokens = TOKENS.light;
    const preview = screen.getByTestId('phone-photo-photo-preview');
    expect(styleOf(preview)).toMatchObject({ width: 96, height: 96 });
    expect(tokenNameOf(tokens, styleOf(preview).backgroundColor)).toContain('brandSoft');
    expect(preview.getAttribute('aria-label')).toBe('Ramesh');
    expect(
      tokenNameOf(tokens, styleOf(screen.getByTestId('phone-photo-photo-badge')).backgroundColor),
    ).toContain('accent');
  });

  it('greets without a name when Google gave none', () => {
    signup({ params: { mode: 'signup', idToken: 'g', name: '' } });
    expect(
      screen.getByRole('heading', { name: STRINGS_EN['phoneAndPhoto.titleNoName'] }),
    ).toBeTruthy();
  });

  it('never creates an account with an empty or invalid phone', () => {
    const h = signup();
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    expect(screen.getByTestId('phone-photo-phone-error').textContent).toBe(
      STRINGS_EN['validation.phone'],
    );
    typePhone('12345');
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    expect(screen.getByTestId('phone-photo-phone-error')).toBeTruthy();
    expect(h.account.createAccountWithGoogle).not.toHaveBeenCalled();
    expect(h.account.updateAccountProfile).not.toHaveBeenCalled();
  });

  it('creates the account from the param ID token and the phone, uploads the photo, re-resolves; the phone-only endpoint is never called', async () => {
    const h = signup();
    await pickPhoto();
    typePhone(' 98765 43210 ');
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.createAccountWithGoogle).toHaveBeenCalledWith({
      idToken: 'google-id-token',
      phone: '98765 43210',
    });
    expect(h.account.uploadPhoto).toHaveBeenCalledWith({
      uri: 'file:///cache/e-0.85.jpg',
      contentType: 'image/jpeg',
    });
    expect(h.account.updateAccountProfile).not.toHaveBeenCalled();
    expect(await h.authStore.account()).toEqual({
      ...ACCOUNT,
      photoUrl: '/api/v1/users/u2/photo',
    });
  });

  it('not reachable stores nothing; a refusal is shown word for word', async () => {
    const h = signup();
    h.account.createAccountWithGoogle.mockRejectedValueOnce(new NotReachable('TIMEOUT'));
    typePhone('9876543210');
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('phone-photo-message').textContent).toBe(
        STRINGS_EN['createAccount.notReachable'],
      ),
    );
    expect(await h.authStore.accessToken()).toBeNull();
    expect(h.shell.refresh).not.toHaveBeenCalled();

    h.account.createAccountWithGoogle.mockRejectedValueOnce(
      new ServerRefusal(
        409,
        'An account with this email already exists. Sign in instead.',
        inferAccountErrorCode,
      ),
    );
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('phone-photo-message').textContent).toBe(
        'An account with this email already exists. Sign in instead.',
      ),
    );
    expect(screen.queryByTestId('phone-photo-google')).toBeNull();
  });

  it('an expired token (INVALID_CREDENTIALS on /auth/signup) keeps the typed phone and photo, says so, and Continue with Google resubmits with the new token (R1.13)', async () => {
    const h = signup();
    await pickPhoto();
    typePhone('+91 98765 43210');
    h.account.createAccountWithGoogle.mockRejectedValueOnce(
      new ServerRefusal(401, 'Invalid credentials', inferAccountErrorCode),
    );
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('phone-photo-message').textContent).toBe(
        STRINGS_EN['phoneAndPhoto.googleExpired'],
      ),
    );
    // Nothing of the server's sentence; the phone and the photo are still there.
    expect(screen.queryByText('Invalid credentials')).toBeNull();
    expect((screen.getByTestId('phone-photo-phone-input') as HTMLInputElement).value).toBe(
      '+91 98765 43210',
    );
    expect(screen.getByTestId('phone-photo-photo-remove')).toBeTruthy();
    expect(await h.authStore.accessToken()).toBeNull();
    // Still exactly one primary button; the Google button is a secondary one next to it.
    const google = screen.getByTestId('phone-photo-google');
    expect(google.textContent).toBe(STRINGS_EN['signIn.google']);
    expect(tokenNameOf(TOKENS.light, styleOf(google).borderColor)).toContain('borderStrong');
    expect(styleOf(screen.getByTestId('phone-photo-submit')).backgroundColor).toBeDefined();

    fireEvent.click(google);
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.googleSignIn.getIdToken).toHaveBeenCalledTimes(1);
    expect(h.account.createAccountWithGoogle).toHaveBeenCalledTimes(2);
    expect(h.account.createAccountWithGoogle).toHaveBeenLastCalledWith({
      idToken: 'fresh-id-token',
      phone: '+91 98765 43210',
    });
    expect(h.account.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(await h.authStore.account()).toEqual({ ...ACCOUNT, photoUrl: UPLOADED.photoUrl });
  });

  it('after an expired token, a cancelled Google picker leaves the step as it is; unavailable says so', async () => {
    const h = signup();
    typePhone('9876543210');
    h.account.createAccountWithGoogle.mockRejectedValueOnce(
      new ServerRefusal(401, 'Invalid credentials', inferAccountErrorCode),
    );
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await screen.findByTestId('phone-photo-google');

    h.googleSignIn.getIdToken.mockResolvedValueOnce({ kind: 'cancelled' } as never);
    fireEvent.click(screen.getByTestId('phone-photo-google'));
    await waitFor(() => expect(h.googleSignIn.getIdToken).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('phone-photo-message').textContent).toBe(
        STRINGS_EN['phoneAndPhoto.googleExpired'],
      ),
    );
    expect(h.account.createAccountWithGoogle).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('phone-photo-phone-input') as HTMLInputElement).value).toBe(
      '9876543210',
    );

    h.googleSignIn.getIdToken.mockResolvedValueOnce({ kind: 'unavailable' } as never);
    fireEvent.click(screen.getByTestId('phone-photo-google'));
    await waitFor(() =>
      expect(screen.getByTestId('phone-photo-message').textContent).toBe(
        STRINGS_EN['signIn.googleUnavailable'],
      ),
    );
    expect(h.account.createAccountWithGoogle).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneAndPhotoScreen, update mode (R1.11, R1.12, R6.2, R6.8; DD20)', () => {
  it('is titled "Add your phone number" with the R1.3 helper, the photo, Save and Log out; no Back, no Google', async () => {
    await update();
    expect(
      screen.getByRole('heading', { name: STRINGS_EN['phoneAndPhoto.updateTitle'] }),
    ).toBeTruthy();
    expect(screen.getByRole('heading').textContent).toBe('Add your phone number');
    expect(screen.getByLabelText(STRINGS_EN['phoneAndPhoto.phone'])).toBeTruthy();
    expect(screen.getByTestId('phone-photo-phone-helper').textContent).toBe(
      "We'll use this number for your shop to contact you",
    );
    expect(screen.getByTestId('phone-photo-photo-camera')).toBeTruthy();
    // The initial of the signed-in account, not a Google name.
    expect(screen.getByTestId('phone-photo-photo-preview').getAttribute('aria-label')).toBe(
      'Anita Desai',
    );
    expect(buttons()).toEqual([
      STRINGS_EN['createAccount.takePhoto'],
      STRINGS_EN['createAccount.chooseFromGallery'],
      STRINGS_EN['phoneAndPhoto.save'],
      STRINGS_EN['common.logOut'],
    ]);
    expect(screen.queryByTestId('phone-photo-back')).toBeNull();
    expect(screen.queryByTestId('phone-photo-google')).toBeNull();
    expect(screen.queryByText(/Almost done/)).toBeNull();
    // Log out in the danger colour, as on every pre-Home screen.
    expect(
      tokenNameOf(
        TOKENS.light,
        styleOf(screen.getByTestId('phone-photo-log-out').querySelector('span') as Element).color,
      ),
    ).toContain('danger');
  });

  it('an empty or invalid phone shows the R1.12 text and makes no call', async () => {
    const h = await update();
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    expect(screen.getByTestId('phone-photo-phone-error').textContent).toBe(
      'Enter a 10-digit mobile number.',
    );
    for (const bad of ['12345', '+91 12345', '98765432101', 'abcdefghij']) {
      typePhone(bad);
      fireEvent.click(screen.getByTestId('phone-photo-submit'));
      expect(screen.getByTestId('phone-photo-phone-error')).toBeTruthy();
    }
    expect(h.account.updateAccountProfile).not.toHaveBeenCalled();
    expect(h.account.createAccountWithGoogle).not.toHaveBeenCalled();
    expect(h.shell.refresh).not.toHaveBeenCalled();
    expect((await h.authStore.profile())?.phone).toBeUndefined();
  });

  it('Save PUTs the normalised phone alone, uploads the picked photo, updates the stored profile and re-resolves', async () => {
    const h = await update();
    await pickPhoto();
    typePhone(' +91 91234 56780 ');
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));

    expect(h.account.updateAccountProfile).toHaveBeenCalledTimes(1);
    expect(h.account.updateAccountProfile).toHaveBeenCalledWith({ phone: '9123456780' });
    expect(h.account.updateAccountProfile.mock.calls[0][0]).not.toHaveProperty('name');
    // The order: profile, then photo (with the session), then the store, then the shell.
    const order = [
      h.account.updateAccountProfile.mock.invocationCallOrder[0],
      h.account.uploadPhoto.mock.invocationCallOrder[0],
      (h.shell.refresh as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h.account.uploadPhoto).toHaveBeenCalledWith({
      uri: 'file:///cache/e-0.85.jpg',
      contentType: 'image/jpeg',
    });
    expect(h.account.createAccountWithGoogle).not.toHaveBeenCalled();
    expect(await h.authStore.account()).toEqual({
      ...NO_PHONE,
      phone: '9123456780',
      photoUrl: UPLOADED.photoUrl,
    });
    expect(screen.queryByTestId('phone-photo-message')).toBeNull();
  });

  it('Save without a photo: no upload; the phone is stored and the shell re-resolves', async () => {
    const h = await update();
    typePhone('9123456780');
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.uploadPhoto).not.toHaveBeenCalled();
    expect(await h.authStore.profile()).toEqual({
      userId: NO_PHONE.userId,
      name: NO_PHONE.name,
      email: NO_PHONE.email,
      role: NO_PHONE.role,
      phone: '9123456780',
    });
  });

  it('a failed photo upload does not undo the saved phone', async () => {
    const h = await update();
    h.account.uploadPhoto.mockRejectedValueOnce(new NotReachable('TIMEOUT'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await pickPhoto();
    typePhone('9123456780');
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect((await h.authStore.profile())?.phone).toBe('9123456780');
    expect((await h.authStore.profile())?.photoUrl).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('not reachable: the R1.12 line, nothing stored, the step stays; a refusal is shown word for word', async () => {
    const h = await update();
    h.account.updateAccountProfile.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    typePhone('9123456780');
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('phone-photo-message').textContent).toBe(
        "Couldn't reach Stockkart. Check your connection and try again.",
      ),
    );
    expect(h.shell.refresh).not.toHaveBeenCalled();
    expect(h.account.uploadPhoto).not.toHaveBeenCalled();
    expect((await h.authStore.profile())?.phone).toBeUndefined();
    // The step is still there with the typed phone and Save.
    expect(screen.getByRole('heading').textContent).toBe('Add your phone number');
    expect((screen.getByTestId('phone-photo-phone-input') as HTMLInputElement).value).toBe(
      '9123456780',
    );

    h.account.updateAccountProfile.mockRejectedValueOnce(
      new ServerRefusal(400, 'Invalid phone number', inferAccountErrorCode),
    );
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('phone-photo-message').textContent).toBe('Invalid phone number'),
    );
    expect(h.shell.refresh).not.toHaveBeenCalled();
  });

  it('a 401 on Save goes to the shell (R9.3) and nothing is shown here', async () => {
    const h = await update();
    h.account.updateAccountProfile.mockRejectedValueOnce(new NotAuthenticated('Token expired'));
    typePhone('9123456780');
    fireEvent.click(screen.getByTestId('phone-photo-submit'));
    await waitFor(() => expect(h.shell.handleError).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('phone-photo-message')).toBeNull();
    expect(h.shell.refresh).not.toHaveBeenCalled();
  });

  it('Log out confirms, ends the session on the server, clears the account set and re-resolves (R6.2, R9.5)', async () => {
    const h = await update();
    fireEvent.click(screen.getByTestId('phone-photo-log-out'));
    expect(screen.getByText(STRINGS_EN['common.logOutQuestion'])).toBeTruthy();
    fireEvent.click(screen.getByTestId('phone-photo-log-out-sheet-confirm'));
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
    expect(h.account.logout).toHaveBeenCalledTimes(1);
    expect(await h.authStore.accessToken()).toBeNull();
    expect(await h.authStore.profile()).toBeNull();
    expect(h.account.updateAccountProfile).not.toHaveBeenCalled();
  });

  it('the title and controls do not depend on the stored profile being readable', async () => {
    const h = harness({ params: UPDATE, onBack: undefined, profile: null });
    h.render();
    expect(screen.getByRole('heading').textContent).toBe('Add your phone number');
    expect(screen.getByTestId('phone-photo-submit').textContent).toBe('Save');
    expect(screen.getByTestId('phone-photo-log-out')).toBeTruthy();
  });
});
