// Task 22.2 — Property 32 (An account that reaches Home always has a phone; R1.4, R1.10, R1.11,
// R1.12, R6.1), the phone-step half: for any string `p` typed into the `update`-mode phone step,
// Save calls `PUT /users/me/profile` (`AccountClient.updateAccountProfile`) iff
// `normalisePhone(p) != null`, with exactly `{phone: normalisePhone(p)}` as the body and no `name`
// field; when `normalisePhone(p)` is null the R1.12 text is shown and nothing is called. The route
// half is in `src/app/AppStateMachine.property.test.ts`; the server half is jqwik in `inventory-api`.
//
// The reference is the protocol's `normalisePhone` (the twin of the Java rule, Property 1), applied
// here to the raw string; the screen's own `validatePhone` is not consulted. Rendering is the real
// screen over fakes; one render per sample, so the runs are kept small (the rule under test is a
// one-line implication, not a layout).
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalisePhone } from '@stockkart/attendance-protocol';

import { NotAuthenticated } from '../api/transport';
import type { AppDeps } from '../app/deps';
import type { ShellActions } from '../app/useAppState';
import { STRINGS_EN } from '../i18n';
import { AuthStore, type StoredAccount } from '../state/authStore';
import type { SecureStorage } from '../state/pairingStore';
import { renderThemed } from '../../test-support/render';
import { PhoneAndPhotoScreen } from './PhoneAndPhotoScreen';
import type { PhotoModules } from './photo';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

afterEach(cleanup);

const NUM_RUNS = 40;

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

const digits10 = fc.stringMatching(/^[0-9]{10}$/);

/** A number the rule accepts, dressed the ways a worker types it (R1.2): spaces, `+91`, `91`, dashes. */
const acceptable: fc.Arbitrary<string> = fc.oneof(
  digits10,
  digits10.map((d) => `+91 ${d.slice(0, 5)} ${d.slice(5)}`),
  digits10.map((d) => `91${d}`),
  digits10.map((d) => `(+91) ${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`),
  digits10.map((d) => ` ${d} `),
);

/** Anything else a worker could type, including inputs close to the rule. */
const anyText: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: 20 }) },
  { weight: 2, arbitrary: fc.stringMatching(/^[0-9 +()-]{0,16}$/) },
  { weight: 1, arbitrary: fc.stringMatching(/^[0-9]{9}$|^[0-9]{11}$|^[0-9]{12}$/) },
  { weight: 1, arbitrary: fc.constantFrom('', '   ', '+91', '९८७६५४३२१०', '98765-4321') },
);

/** Even odds of a valid and an invalid input, so both arms of the "iff" are exercised. */
const typed: fc.Arbitrary<string> = fc.oneof(acceptable, anyText);

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

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

const NO_PHONE: StoredAccount = {
  userId: 'u3',
  name: 'Anita Desai',
  email: 'anita@example.in',
  role: 'WORKER',
  accessToken: 'tok-3',
};

async function mountUpdateStep() {
  const authStore = new AuthStore({ storage: memoryStorage() });
  await authStore.saveAccount(NO_PHONE);
  const updateAccountProfile = vi.fn(async (request: { phone: string }) => ({
    userId: NO_PHONE.userId,
    role: NO_PHONE.role,
    email: NO_PHONE.email,
    name: NO_PHONE.name,
    phone: request.phone,
  }));
  const photo: PhotoModules = {
    picker: { pick: vi.fn(async () => ({ kind: 'cancelled' as const })) },
    manipulator: { encodeJpeg: vi.fn() },
  };
  const deps = {
    authStore,
    account: { updateAccountProfile, uploadPhoto: vi.fn(), logout: vi.fn() },
    photo,
    pairingStore: { load: vi.fn(async () => null), wipe: vi.fn() },
  } as unknown as AppDeps;
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn((error: unknown) => error instanceof NotAuthenticated),
    confirm: vi.fn(async () => true),
  };
  renderThemed(
    <PhoneAndPhotoScreen
      deps={deps}
      shell={shell}
      params={{ mode: 'update' }}
      profile={NO_PHONE}
    />,
  );
  return { authStore, updateAccountProfile, shell };
}

// ---------------------------------------------------------------------------------------------
// Property 32, phone-step half
// ---------------------------------------------------------------------------------------------

describe('Feature: worker-app, Property 32: An account that reaches Home always has a phone (phone-step half)', () => {
  it('for any typed string p, Save calls PUT /users/me/profile iff normalisePhone(p) != null, with exactly {phone: normalisePhone(p)} and no name; otherwise the R1.12 text and no call', async () => {
    await fc.assert(
      fc.asyncProperty(typed, async (p) => {
        cleanup();
        const h = await mountUpdateStep();
        const expected = normalisePhone(p);

        fireEvent.change(screen.getByTestId('phone-photo-phone-input'), { target: { value: p } });
        fireEvent.click(screen.getByTestId('phone-photo-submit'));

        if (expected == null) {
          expect(screen.getByTestId('phone-photo-phone-error').textContent).toBe(
            STRINGS_EN['validation.phone'],
          );
          expect(h.updateAccountProfile).not.toHaveBeenCalled();
          expect(h.shell.refresh).not.toHaveBeenCalled();
          expect((await h.authStore.profile())?.phone).toBeUndefined();
        } else {
          await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
          expect(h.updateAccountProfile).toHaveBeenCalledTimes(1);
          const body = h.updateAccountProfile.mock.calls[0][0];
          expect(body).toEqual({ phone: expected });
          expect(Object.keys(body)).toEqual(['phone']);
          expect(body.phone).toMatch(/^[0-9]{10}$/);
          expect((await h.authStore.profile())?.phone).toBe(expected);
          expect(screen.queryByTestId('phone-photo-phone-error')).toBeNull();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
