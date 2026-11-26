import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkerProfileResponse } from '@stockkart/attendance-protocol';

import { renderThemed } from '../../test-support/render';
import type { PhotoModules, PickedImage } from '../account/photo';
import { inferAccountErrorCode } from '../api/accountClient';
import { NotAuthenticated, NotReachable, ServerRefusal } from '../api/transport';
import type { AppDeps } from '../app/deps';
import type { ShellActions } from '../app/useAppState';
import { STRINGS_EN } from '../i18n';
import { AuthStore, type StoredAccount } from '../state/authStore';
import type { SecureStorage } from '../state/pairingStore';
import { EditDetailsScreen } from './EditDetailsScreen';

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
  photoUrl: '/api/v1/users/u1/photo',
  role: 'WORKER',
  accessToken: 'tok',
};

const PICKED: PickedImage = { uri: 'file:///cache/o.jpg', width: 800, height: 800 };

function serverProfile(name: string, phone: string): WorkerProfileResponse {
  return {
    name,
    phone,
    email: ACCOUNT.email,
    photoUrl: ACCOUNT.photoUrl,
    shopName: 'Sri Ganesh Stores',
    employeeCode: 'EMP-015',
    joinDate: '2025-04-03',
    profileRequested: false,
    pairingState: 'PAIRED',
  };
}

async function harness(options: { photoUrl?: boolean } = {}) {
  const authStore = new AuthStore({ storage: memoryStorage() });
  const stored = options.photoUrl === false ? { ...ACCOUNT, photoUrl: undefined } : ACCOUNT;
  await authStore.saveAccount(stored);
  const account = {
    updateProfile: vi.fn(async (request: { name: string; phone: string }) =>
      serverProfile(request.name, request.phone),
    ),
    uploadPhoto: vi.fn(async () => ({
      photoUrl: '/api/v1/users/u1/photo',
      contentType: 'image/jpeg',
      bytes: 90 * 1024,
      updatedAt: '2025-05-12T09:00:00Z',
    })),
    deletePhoto: vi.fn(async () => ({ deleted: true })),
    imageSource: vi.fn(async (photoUrl: string) => ({
      uri: `https://api.test.invalid${photoUrl}`,
      headers: { Authorization: 'Bearer tok' },
    })),
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
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn((error: unknown) => error instanceof NotAuthenticated),
    confirm: vi.fn(async () => true),
  };
  const deps = { authStore, account, photo } as unknown as AppDeps;
  const onDone = vi.fn();
  const profile = await authStore.profile();
  const view = renderThemed(
    <EditDetailsScreen deps={deps} shell={shell} profile={profile} onDone={onDone} />,
  );
  return { ...view, authStore, account, photo, shell, onDone };
}

function type(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(`${testID}-input`), { target: { value } });
}

describe('EditDetailsScreen (R8.2)', () => {
  it('starts from the stored name, phone and photo; the e-mail is not a field; Save is the one primary button', async () => {
    await harness();
    expect((screen.getByTestId('edit-details-name-input') as HTMLInputElement).value).toBe(
      'Priya Sharma',
    );
    expect((screen.getByTestId('edit-details-phone-input') as HTMLInputElement).value).toBe(
      '9876543210',
    );
    expect(screen.queryByDisplayValue('priya@example.in')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('edit-details-photo-preview').getAttribute('src')).toBe(
        'https://api.test.invalid/api/v1/users/u1/photo',
      ),
    );
    expect(screen.getByTestId('edit-details-photo-remove')).toBeTruthy();
    expect(
      screen.getByTestId('screen-edit-details-footer').querySelector('button')?.textContent,
    ).toBe(STRINGS_EN['editDetails.save']);
  });

  it('refuses a bad name or phone on the phone and sends nothing (R1.2)', async () => {
    const h = await harness();
    type('edit-details-name', 'P');
    type('edit-details-phone', '12345');
    fireEvent.click(screen.getByTestId('edit-details-save'));
    expect(screen.getByTestId('edit-details-name-error').textContent).toBe(
      STRINGS_EN['validation.name'],
    );
    expect(screen.getByTestId('edit-details-phone-error').textContent).toBe(
      STRINGS_EN['validation.phone'],
    );
    expect(h.account.updateProfile).not.toHaveBeenCalled();
    expect(h.onDone).not.toHaveBeenCalled();
  });

  it('saves the name and phone to the server and the store, then re-reads and returns', async () => {
    const h = await harness();
    type('edit-details-name', '  Priya S. Sharma ');
    type('edit-details-phone', '+91 98765 43211');
    fireEvent.click(screen.getByTestId('edit-details-save'));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(h.account.updateProfile).toHaveBeenCalledWith({
      name: 'Priya S. Sharma',
      phone: '+91 98765 43211',
    });
    expect(h.account.uploadPhoto).not.toHaveBeenCalled();
    expect(h.account.deletePhoto).not.toHaveBeenCalled();
    expect(h.shell.refresh).toHaveBeenCalledTimes(1);
    const stored = await h.authStore.profile();
    expect(stored).toMatchObject({
      name: 'Priya S. Sharma',
      phone: '+91 98765 43211',
      photoUrl: ACCOUNT.photoUrl,
    });
  });

  it('with nothing changed, Save sends no profile update but still returns', async () => {
    const h = await harness();
    fireEvent.click(screen.getByTestId('edit-details-save'));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(h.account.updateProfile).not.toHaveBeenCalled();
  });

  it('a new photo is uploaded after the details and its URL kept (R1.7)', async () => {
    const h = await harness({ photoUrl: false });
    expect(screen.queryByTestId('edit-details-photo-remove')).toBeNull();
    fireEvent.click(screen.getByTestId('edit-details-photo-gallery'));
    await waitFor(() => expect(screen.getByTestId('edit-details-photo-remove')).toBeTruthy());
    fireEvent.click(screen.getByTestId('edit-details-save'));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(h.account.uploadPhoto).toHaveBeenCalledWith({
      uri: 'file:///cache/e-0.85.jpg',
      contentType: 'image/jpeg',
    });
    expect((await h.authStore.profile())?.photoUrl).toBe('/api/v1/users/u1/photo');
  });

  it('Remove photo on the stored one deletes it on the server and from the store', async () => {
    const h = await harness();
    fireEvent.click(await screen.findByTestId('edit-details-photo-remove'));
    expect(screen.getByTestId('edit-details-photo-preview').getAttribute('src')).toBeNull();
    fireEvent.click(screen.getByTestId('edit-details-save'));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(h.account.deletePhoto).toHaveBeenCalledTimes(1);
    expect(h.account.uploadPhoto).not.toHaveBeenCalled();
    expect((await h.authStore.profile())?.photoUrl).toBeUndefined();
  });

  it('removing a fresh pick goes back to the stored photo, not to "remove"', async () => {
    const h = await harness();
    fireEvent.click(screen.getByTestId('edit-details-photo-camera'));
    await waitFor(() =>
      expect(screen.getByTestId('edit-details-photo-preview').getAttribute('src')).toBe(
        'file:///cache/e-0.85.jpg',
      ),
    );
    fireEvent.click(screen.getByTestId('edit-details-photo-remove'));
    await waitFor(() =>
      expect(screen.getByTestId('edit-details-photo-preview').getAttribute('src')).toBe(
        'https://api.test.invalid/api/v1/users/u1/photo',
      ),
    );
    fireEvent.click(screen.getByTestId('edit-details-save'));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
    expect(h.account.deletePhoto).not.toHaveBeenCalled();
    expect(h.account.uploadPhoto).not.toHaveBeenCalled();
  });

  it('not reachable: "Your details were not changed", nothing stored, the screen stays (R6.7)', async () => {
    const h = await harness();
    h.account.updateProfile.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    type('edit-details-name', 'Priya S. Sharma');
    fireEvent.click(screen.getByTestId('edit-details-save'));
    expect((await screen.findByTestId('edit-details-message')).textContent).toBe(
      STRINGS_EN['editDetails.notReachable'],
    );
    expect(h.onDone).not.toHaveBeenCalled();
    expect(h.shell.refresh).not.toHaveBeenCalled();
    expect((await h.authStore.profile())?.name).toBe('Priya Sharma');
  });

  it('a refusal is shown word for word; a 401 goes to the shell and shows nothing here (R9.3)', async () => {
    const h = await harness();
    h.account.updateProfile.mockRejectedValueOnce(
      new ServerRefusal(400, 'Enter a 10-digit mobile number.', inferAccountErrorCode),
    );
    type('edit-details-phone', '9876543211');
    fireEvent.click(screen.getByTestId('edit-details-save'));
    expect((await screen.findByTestId('edit-details-message')).textContent).toBe(
      'Enter a 10-digit mobile number.',
    );

    h.account.updateProfile.mockRejectedValueOnce(new NotAuthenticated('expired'));
    fireEvent.click(screen.getByTestId('edit-details-save'));
    await waitFor(() => expect(h.shell.handleError).toHaveReturnedWith(true));
    expect(screen.queryByTestId('edit-details-message')).toBeNull();
    expect(h.onDone).not.toHaveBeenCalled();
  });

  it('Cancel returns without sending anything', async () => {
    const h = await harness();
    type('edit-details-name', 'Someone Else');
    fireEvent.click(screen.getByTestId('edit-details-cancel'));
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.account.updateProfile).not.toHaveBeenCalled();
    expect((await h.authStore.profile())?.name).toBe('Priya Sharma');
  });
});
