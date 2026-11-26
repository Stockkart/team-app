import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OAUTH_ACCOUNT_NOT_FOUND } from '@stockkart/attendance-protocol';
import type {
  UnpairResponse,
  WorkerProfileResponse,
  WorkerStateResponse,
} from '@stockkart/attendance-protocol';

import { emitAppState, pressHardwareBack } from '../../test-support/react-native-dom';
import { focusedRouteName, mountedRouteNames } from '../../test-support/fake-navigation';
import type { AppDeps } from '../app/deps';
import { appStateForeground } from '../app/foreground';
import { inferAccountErrorCode } from '../api/accountClient';
import { NotAuthenticated, NotReachable, ServerRefusal } from '../api/transport';
import { STRINGS_EN } from '../i18n';
import { AuthStore, type StoredAccount } from '../state/authStore';
import { PairingStore, type SecureStorage } from '../state/pairingStore';
import { staticTheme, ThemeContext } from '../theme';
import { RootNavigator } from './RootNavigator';

// The navigator runs in jsdom with `react-native` aliased to DOM elements (vite.config.mts) and
// both react-navigation packages replaced by the in-memory stack of `test-support/fake-navigation`.
vi.mock('@react-navigation/native', () => import('../../test-support/fake-navigation'));
vi.mock('@react-navigation/native-stack', () => import('../../test-support/fake-navigation'));
// `Screen` reads the safe area; `QrScanner` (behind the HR-module Pair screen) imports the camera.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [null, async () => undefined],
}));
// The Attendance module mounts the check-in screen (`modules/PunchScreen`, DD17) in both states; it
// has its own tests and needs the whole of `AppDeps` (sync worker, punch flow). Here a marker: the
// code button when not enabled, so the navigator's Pair route can be reached, else `punch-home`.
vi.mock('../modules/PunchScreen', () => ({
  PunchScreen: ({ enabled, onHaveCode }: { enabled: boolean; onHaveCode: () => void }) =>
    enabled ? (
      <div data-testid="punch-home" />
    ) : (
      <button type="button" data-testid="attendance-code" onClick={onHaveCode} />
    ),
}));
// The stores bind the secure store and expo-crypto at module load; the tests inject memory storage.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

// --- fakes ---

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

const PAIRING = {
  pairingId: '66f1a2b3c4d5e6f708192a3b',
  shopId: '5f1a2b3c4d5e6f7081920001',
  employeeId: '5f1a2b3c4d5e6f7081920002',
  employeeName: 'Ravi Kumar',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: false },
  consentVersion: 1,
};

const ACCOUNT = {
  userId: 'u1',
  name: 'Priya Sharma',
  email: 'priya@example.in',
  phone: '9876543210',
  role: 'WORKER' as const,
};

function stateAnswer(
  partial: Partial<WorkerStateResponse> & Pick<WorkerStateResponse, 'state'>,
): WorkerStateResponse {
  return {
    account: ACCOUNT,
    modules: [],
    notifications: { unread: 0, top: [] },
    serverTime: '2025-05-12T09:00:00Z',
    ...partial,
  };
}

const ACTIVE = stateAnswer({
  state: 'ACTIVE',
  shop: { shopId: 's1', shopName: 'Sri Ganesh Stores' },
  employee: {
    employeeId: 'e1',
    code: 'EMP-015',
    name: 'Priya Sharma',
    joinDate: '2025-05-12',
    status: 'ACTIVE',
  },
  modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
  pairing: { state: 'NOT_PAIRED' },
});

const REQUEST = {
  id: 'r1',
  shopName: 'Sri Ganesh Stores',
  status: 'PENDING' as const,
  requestedAt: '2025-05-12T08:00:00Z',
};

const PENDING = stateAnswer({ state: 'PENDING', request: REQUEST });

interface Harness {
  deps: AppDeps;
  authStore: AuthStore;
  pairingStore: PairingStore;
  workerState: ReturnType<typeof vi.fn<() => Promise<WorkerStateResponse>>>;
  signIn: ReturnType<typeof vi.fn<() => Promise<StoredAccount>>>;
  unpairMe: ReturnType<typeof vi.fn<() => Promise<UnpairResponse>>>;
  /** Offline punches waiting on the phone; the switch flow counts them (R9.7). */
  waiting: { count: number };
  keys: { deleted: number };
}

function harness(): Harness {
  const storage = memoryStorage();
  const authStore = new AuthStore({ storage });
  const waiting = { count: 0 };
  const keys = { deleted: 0 };
  const pairingStore = new PairingStore({
    storage,
    randomUUID: () => 'uuid',
    deleteKeys: async () => {
      keys.deleted += 1;
    },
    deleteQueue: async () => {
      waiting.count = 0;
    },
    forgetOwner: () => authStore.clearPairingOwner(),
  });
  const workerState = vi.fn<() => Promise<WorkerStateResponse>>(async () => ACTIVE);
  // The Profile route reads `GET /hr/worker/profile` at mount (task 14.4).
  const profile = vi.fn<() => Promise<WorkerProfileResponse>>(async () => ({
    name: ACCOUNT.name,
    phone: ACCOUNT.phone,
    email: ACCOUNT.email,
    shopName: 'Sri Ganesh Stores',
    employeeCode: 'EMP-015',
    joinDate: '2025-04-03',
    profileRequested: false,
    pairingState: 'NOT_PAIRED',
  }));
  const signIn = vi.fn<() => Promise<StoredAccount>>(async () => ({
    ...ACCOUNT,
    accessToken: 'tok',
  }));
  const unpairMe = vi.fn<() => Promise<UnpairResponse>>(async () => ({ unpaired: true }));
  const deps = {
    authStore,
    pairingStore,
    account: { workerState, profile, signIn, uploadPhoto: vi.fn() },
    // The phone step's photo picker; never tapped here.
    photo: { picker: { pick: vi.fn() }, manipulator: { encodeJpeg: vi.fn() } },
    client: { unpairMe },
    queue: { waitingCount: async () => waiting.count },
    // The Pair route mounts the HR-module `PairScreen`, which reads the lockout at mount.
    workerPairingFlow: { lockoutRemainingMs: () => 0, parseCode: () => null },
    foreground: appStateForeground,
    onPairingEnded: () => () => undefined,
    appVersion: '1.0.0 (1)',
  } as unknown as AppDeps;
  return {
    deps,
    authStore,
    pairingStore,
    workerState,
    signIn,
    unpairMe,
    waiting,
    keys,
  };
}

/** Types e-mail and password into the focused Sign in screen and taps Sign in. */
function submitSignIn(email: string): void {
  const form = focused();
  fireEvent.change(within(form).getByTestId('sign-in-email-input'), { target: { value: email } });
  fireEvent.change(within(form).getByTestId('sign-in-password-input'), {
    target: { value: 'secret-pw' },
  });
  fireEvent.click(within(form).getByTestId('sign-in-submit'));
}

async function signedIn(h: Harness): Promise<void> {
  await h.authStore.saveAccount({ ...ACCOUNT, accessToken: 'tok' });
}

function renderNavigator(deps: AppDeps) {
  return render(
    <ThemeContext.Provider value={staticTheme('light')}>
      <RootNavigator deps={deps} />
    </ThemeContext.Provider>,
  );
}

function focused(): HTMLElement {
  const name = focusedRouteName();
  if (name == null) {
    throw new Error('no focused route');
  }
  return document.querySelector(`[data-route="${name}"]`) as HTMLElement;
}

async function waitForRoute(name: string): Promise<void> {
  await waitFor(() => expect(focusedRouteName()).toBe(name));
}

// --- tests ---

describe('RootNavigator (worker-app task 13.4)', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the splash while resolving, then Sign in when no account is stored (R1.6)', async () => {
    renderNavigator(h.deps);
    expect(screen.getByTestId('shell-resolving')).toBeTruthy();
    await waitForRoute('SignIn');
    expect(within(focused()).getByTestId('screen-sign-in')).toBeTruthy();
    // No session, no network call.
    expect(h.workerState).not.toHaveBeenCalled();
    expect(mountedRouteNames()).toEqual(['SignIn']);
  });

  it('a stored pairing changes nothing before sign-in: the same screen, nothing touched (R1.1, D11)', async () => {
    await h.pairingStore.save(PAIRING);
    await h.authStore.setPairingOwnerUserId('u1');
    renderNavigator(h.deps);
    await waitForRoute('SignIn');
    expect(mountedRouteNames()).toEqual(['SignIn']);
    expect(
      within(focused())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      STRINGS_EN['signIn.submit'],
      STRINGS_EN['signIn.google'],
      STRINGS_EN['signIn.forgotPassword'],
      STRINGS_EN['signIn.createAccount'],
    ]);
    // Back from Sign in leaves the app (R6.8); the pairing and its owner are untouched.
    expect(pressHardwareBack()).toBe(false);
    expect(await h.pairingStore.load()).toEqual(PAIRING);
    expect(await h.authStore.pairingOwnerUserId()).toBe('u1');
    expect(h.workerState).not.toHaveBeenCalled();
  });

  it('routes NO_SHOP → Join, PENDING → Waiting, STAFF_NO_EMPLOYEE → Blocked (R5.5, R6.1)', async () => {
    await signedIn(h);
    h.workerState.mockResolvedValueOnce(stateAnswer({ state: 'NO_SHOP' }));
    const { unmount } = renderNavigator(h.deps);
    await waitForRoute('Join');
    expect(within(focused()).getByText('Hello, Priya Sharma')).toBeTruthy();
    expect(await h.authStore.lastState()).toMatchObject({ state: 'NO_SHOP' });
    unmount();

    h.workerState.mockResolvedValueOnce(PENDING);
    const second = renderNavigator(h.deps);
    await waitForRoute('Waiting');
    expect(mountedRouteNames()).toEqual(['Waiting']);
    second.unmount();

    h.workerState.mockResolvedValueOnce(stateAnswer({ state: 'STAFF_NO_EMPLOYEE' }));
    renderNavigator(h.deps);
    await waitForRoute('Blocked');
    expect(within(focused()).getByText(STRINGS_EN['blocked.staffNoEmployee'])).toBeTruthy();
  });

  it('opens Home for ACTIVE, walks the modules and applies the back rule (R6.4, R6.8)', async () => {
    await signedIn(h);
    renderNavigator(h.deps);
    await waitForRoute('Home');
    expect(h.workerState).toHaveBeenCalledTimes(1);

    fireEvent.click(within(focused()).getByTestId('home-module-profile'));
    await waitForRoute('Profile');
    fireEvent.click(within(focused()).getByTestId('profile-edit'));
    await waitForRoute('EditDetails');

    // EditDetails → Profile → Home → exit.
    expect(pressHardwareBack()).toBe(true);
    await waitForRoute('Profile');
    expect(pressHardwareBack()).toBe(true);
    await waitForRoute('Home');
    expect(pressHardwareBack()).toBe(false);
    expect(focusedRouteName()).toBe('Home');

    // Returning to Home re-resolved the shell twice (one per focus regained), never overlapping.
    expect(h.workerState).toHaveBeenCalledTimes(3);

    // Attendance → "I have a code" → Pair; back → Attendance. (The module reads the pairing store
    // first; this phone holds none, so it is Not enabled.)
    fireEvent.click(within(focused()).getByTestId('home-module-attendance'));
    await waitForRoute('Attendance');
    fireEvent.click(await within(focused()).findByTestId('attendance-code'));
    await waitForRoute('Pair');
    expect(pressHardwareBack()).toBe(true);
    await waitForRoute('Attendance');
  });

  it('"Yes, this is me" on the Pair route shows the signed-in account\'s first and last name and shop, not the code\'s, and Consent repeats them (R7.2)', async () => {
    // The manager's code was created for "Ravi Kumar at Sharma Stores"; the worker signed in as
    // Priya Sharma at Sri Ganesh Stores. The pairing flow is a stub whose claim carries the code's
    // names, so the only way those names could appear is through the screen.
    const codeClaim = {
      claimToken: 'claim-token-1',
      shopName: 'Sharma Stores',
      employeeName: 'Ravi Kumar',
      consent: {
        version: 1,
        kind: 'RECONSENT_REQUIRED' as const,
        recorded: ['Your check-in and check-out time'],
        neverRecorded: ['Your fingerprint'],
        visibility: ["The shop's managers can see your attendance"],
      },
    };
    const submitCode = vi.fn(async (code: string) => ({
      kind: 'claimed' as const,
      code,
      claim: codeClaim,
    }));
    Object.assign(h.deps.workerPairingFlow as unknown as object, { submitCode });
    await signedIn(h);
    renderNavigator(h.deps);
    await waitForRoute('Home');

    fireEvent.click(within(focused()).getByTestId('home-module-attendance'));
    await waitForRoute('Attendance');
    fireEvent.click(await within(focused()).findByTestId('attendance-code'));
    await waitForRoute('Pair');
    fireEvent.change(within(focused()).getByLabelText('Pairing code'), {
      target: { value: 'ABCD2345' },
    });
    fireEvent.click(within(focused()).getByRole('button', { name: 'Continue' }));

    expect((await within(focused()).findByTestId('pair-employee-name')).textContent).toBe(
      ACCOUNT.name,
    );
    expect(within(focused()).getByTestId('pair-shop-name').textContent).toBe('Sri Ganesh Stores');
    expect(within(focused()).queryByText('Ravi Kumar')).toBeNull();
    expect(within(focused()).queryByText('Sharma Stores')).toBeNull();
    expect(submitCode).toHaveBeenCalledTimes(1);

    fireEvent.click(within(focused()).getByRole('button', { name: 'Yes, this is me' }));
    await waitForRoute('Consent');
    expect(
      within(focused()).getByText(
        `${ACCOUNT.name} at Sri Ganesh Stores. Please read, then choose.`,
      ),
    ).toBeTruthy();
    expect(within(focused()).queryByText(/Ravi Kumar/)).toBeNull();
  });

  it('moves from Waiting to Home when a later read says ACTIVE (R3.10)', async () => {
    await signedIn(h);
    h.workerState.mockResolvedValueOnce(PENDING);
    renderNavigator(h.deps);
    await waitForRoute('Waiting');

    // The next read (here: the app coming to the foreground) says ACTIVE.
    h.workerState.mockResolvedValueOnce(ACTIVE);
    act(() => {
      emitAppState('background');
    });
    act(() => {
      emitAppState('active');
    });
    await waitForRoute('Home');
  });

  it('shows Home offline from the last state, or Offline when there is none (R6.7)', async () => {
    await signedIn(h);
    await h.authStore.saveLastState(ACTIVE);
    h.workerState.mockRejectedValueOnce(new NotReachable('TIMEOUT'));
    const first = renderNavigator(h.deps);
    await waitForRoute('Home');
    first.unmount();

    const fresh = harness();
    await signedIn(fresh);
    fresh.workerState.mockRejectedValueOnce(new NotReachable('CONNECTION'));
    renderNavigator(fresh.deps);
    await waitForRoute('Offline');
    // Retry reads again and follows the answer.
    fresh.workerState.mockResolvedValueOnce(ACTIVE);
    fireEvent.click(within(focused()).getByTestId('offline-retry'));
    await waitForRoute('Home');
  });

  it('handles "not authenticated" in one place: token gone, pairing and last state kept (R9.3)', async () => {
    await signedIn(h);
    await h.authStore.saveLastState(ACTIVE);
    await h.pairingStore.save(PAIRING);
    await h.authStore.setPairingOwnerUserId('u1');
    h.workerState.mockRejectedValueOnce(new NotAuthenticated('Token expired'));
    renderNavigator(h.deps);
    await waitForRoute('SignIn');
    expect(within(focused()).getByTestId('sign-in-session-ended')).toBeTruthy();
    expect(await h.authStore.accessToken()).toBeNull();
    expect(await h.authStore.profile()).toMatchObject({ userId: 'u1' });
    expect(await h.authStore.lastState()).toMatchObject({ state: 'ACTIVE' });
    expect(await h.pairingStore.load()).toMatchObject({ pairingId: PAIRING.pairingId });
    expect(await h.authStore.pairingOwnerUserId()).toBe('u1');
  });

  describe('an account without a phone (R1.10, R1.11, R6.8; DD20)', () => {
    const NO_PHONE_ACCOUNT = { ...ACCOUNT, phone: undefined };

    /** `GET /hr/worker/me` for an account whose `phone` is empty, in the given shop state. */
    function withoutPhone(
      partial: Partial<WorkerStateResponse> & Pick<WorkerStateResponse, 'state'>,
    ): WorkerStateResponse {
      return stateAnswer({ ...partial, account: { ...ACCOUNT, phone: null } });
    }

    it.each<WorkerStateResponse>([
      withoutPhone({ state: 'NO_SHOP' }),
      withoutPhone({ state: 'PENDING', request: REQUEST }),
      withoutPhone({ ...ACTIVE, state: 'ACTIVE' }),
      withoutPhone({
        state: 'STAFF_NO_EMPLOYEE',
        account: { ...ACCOUNT, phone: null, role: 'MANAGER' },
      }),
    ])(
      'a $state answer with no phone mounts PhoneAndPhoto in update mode and nothing of Home / Join / Waiting / Blocked',
      async (answer) => {
        await signedIn(h);
        h.workerState.mockResolvedValue(answer);
        renderNavigator(h.deps);
        await waitForRoute('PhoneAndPhoto');
        expect(mountedRouteNames()).toEqual(['PhoneAndPhoto']);
        const step = focused();
        expect(within(step).getByRole('heading').textContent).toBe(
          STRINGS_EN['phoneAndPhoto.updateTitle'],
        );
        expect(within(step).getByTestId('phone-photo-submit').textContent).toBe(
          STRINGS_EN['phoneAndPhoto.save'],
        );
        expect(within(step).getByTestId('phone-photo-log-out')).toBeTruthy();
        expect(within(step).queryByTestId('phone-photo-back')).toBeNull();
        expect(screen.queryByTestId('screen-join')).toBeNull();
        expect(screen.queryByTestId('screen-waiting')).toBeNull();
        expect(screen.queryByTestId('screen-blocked')).toBeNull();
        expect(screen.queryByTestId('home-module-attendance')).toBeNull();
        // The answer was stored anyway, so the next resolve has the truth (DD20).
        expect(await h.authStore.lastState()).toMatchObject({ state: answer.state });
        expect((await h.authStore.profile())?.phone).toBeUndefined();
        // Hardware back from the step leaves the app (R6.8): a pre-Home root, never Home.
        expect(pressHardwareBack()).toBe(false);
        expect(focusedRouteName()).toBe('PhoneAndPhoto');
      },
    );

    it('a stored account without a phone and no network: the phone step, not Home offline, even from an ACTIVE last state (R6.7)', async () => {
      await h.authStore.saveAccount({ ...NO_PHONE_ACCOUNT, accessToken: 'tok' });
      await h.authStore.saveLastState(ACTIVE);
      h.workerState.mockRejectedValueOnce(new NotReachable('TIMEOUT'));
      renderNavigator(h.deps);
      await waitForRoute('PhoneAndPhoto');
      expect(mountedRouteNames()).toEqual(['PhoneAndPhoto']);
      expect(screen.queryByTestId('home-module-attendance')).toBeNull();
      expect(screen.queryByTestId('screen-offline')).toBeNull();
    });

    it('Save sends the phone alone, then the next read lands on the screen the state names; the profile carries the phone (R1.11)', async () => {
      await signedIn(h);
      const updateAccountProfile = vi.fn(async (request: { phone: string }) => ({
        ...ACCOUNT,
        phone: request.phone,
      }));
      Object.assign(h.deps.account as unknown as object, { updateAccountProfile });
      h.workerState.mockResolvedValueOnce(withoutPhone({ state: 'NO_SHOP' }));
      renderNavigator(h.deps);
      await waitForRoute('PhoneAndPhoto');

      // The server now has the phone: the read after Save says so.
      h.workerState.mockResolvedValue(
        stateAnswer({ state: 'NO_SHOP', account: { ...ACCOUNT, phone: '9123456780' } }),
      );
      fireEvent.change(within(focused()).getByTestId('phone-photo-phone-input'), {
        target: { value: '+91 91234 56780' },
      });
      fireEvent.click(within(focused()).getByTestId('phone-photo-submit'));
      await waitForRoute('Join');
      expect(updateAccountProfile).toHaveBeenCalledTimes(1);
      expect(updateAccountProfile).toHaveBeenCalledWith({ phone: '9123456780' });
      expect(within(focused()).getByText('Hello, Priya Sharma')).toBeTruthy();
      expect((await h.authStore.profile())?.phone).toBe('9123456780');
    });

    it('the /me answer refreshes the stored phone both ways: a phone saved on the web is picked up on the next read; one removed sends the account to the step', async () => {
      // Stored without a phone; the server already has one (saved from the web): Join, profile updated.
      await h.authStore.saveAccount({ ...NO_PHONE_ACCOUNT, accessToken: 'tok' });
      h.workerState.mockResolvedValueOnce(stateAnswer({ state: 'NO_SHOP' }));
      const first = renderNavigator(h.deps);
      await waitForRoute('Join');
      expect((await h.authStore.profile())?.phone).toBe(ACCOUNT.phone);
      first.unmount();

      // Stored with a phone; the server says none: the step, profile phone dropped.
      h.workerState.mockResolvedValueOnce(withoutPhone({ state: 'NO_SHOP' }));
      renderNavigator(h.deps);
      await waitForRoute('PhoneAndPhoto');
      expect((await h.authStore.profile())?.phone).toBeUndefined();
    });

    it('Log out from the phone step: the account set goes, Sign in is shown (R6.2, R9.5)', async () => {
      await signedIn(h);
      const logout = vi.fn(async () => ({ success: true }));
      Object.assign(h.deps.account as unknown as object, { logout });
      h.workerState.mockResolvedValue(withoutPhone({ state: 'NO_SHOP' }));
      renderNavigator(h.deps);
      await waitForRoute('PhoneAndPhoto');
      fireEvent.click(within(focused()).getByTestId('phone-photo-log-out'));
      fireEvent.click(screen.getByTestId('phone-photo-log-out-sheet-confirm'));
      await waitForRoute('SignIn');
      expect(logout).toHaveBeenCalledTimes(1);
      expect(await h.authStore.accessToken()).toBeNull();
      expect(await h.authStore.profile()).toBeNull();
    });

    it('Sign in with Google and no Stockkart account opens the phone step in signup mode with the token; Back returns to Sign in (R1.10)', async () => {
      const signInWithGoogle = vi.fn(async () => {
        throw new ServerRefusal(401, OAUTH_ACCOUNT_NOT_FOUND, inferAccountErrorCode);
      });
      const createAccountWithGoogle = vi.fn(async () => ({ ...ACCOUNT, accessToken: 'tok' }));
      Object.assign(h.deps.account as unknown as object, {
        signInWithGoogle,
        createAccountWithGoogle,
      });
      Object.assign(h.deps as unknown as object, {
        googleSignIn: {
          getIdToken: vi.fn(async () => ({ kind: 'id_token' as const, idToken: 'g-token' })),
        },
      });
      h.workerState.mockResolvedValue(stateAnswer({ state: 'NO_SHOP' }));
      renderNavigator(h.deps);
      await waitForRoute('SignIn');
      fireEvent.click(within(focused()).getByTestId('sign-in-google'));
      await waitForRoute('PhoneAndPhoto');
      // Signed-out group: Sign in is still in the stack behind the step; the step is in signup mode.
      expect(mountedRouteNames()).toEqual(['SignIn', 'PhoneAndPhoto']);
      expect(within(focused()).getByRole('heading').textContent).toBe(
        STRINGS_EN['phoneAndPhoto.titleNoName'],
      );
      expect(within(focused()).getByTestId('phone-photo-submit').textContent).toBe(
        STRINGS_EN['phoneAndPhoto.submit'],
      );
      expect(screen.queryByText(/sign up first/i)).toBeNull();
      expect(await h.authStore.accessToken()).toBeNull();

      // Back goes to whichever screen opened it: Sign in here.
      fireEvent.click(within(focused()).getByTestId('phone-photo-back'));
      await waitForRoute('SignIn');

      // Again, and this time the phone: the account is created with the same token, then Join.
      fireEvent.click(within(focused()).getByTestId('sign-in-google'));
      await waitForRoute('PhoneAndPhoto');
      fireEvent.change(within(focused()).getByTestId('phone-photo-phone-input'), {
        target: { value: '9876543210' },
      });
      fireEvent.click(within(focused()).getByTestId('phone-photo-submit'));
      await waitForRoute('Join');
      expect(createAccountWithGoogle).toHaveBeenCalledWith({
        idToken: 'g-token',
        phone: '9876543210',
      });
      expect(await h.authStore.profile()).toMatchObject({ userId: 'u1', phone: ACCOUNT.phone });
    });
  });

  describe('signing in again on a paired phone (R9.5, R9.6, R9.7)', () => {
    const PAIRED_ACTIVE = {
      ...ACTIVE,
      pairing: { state: 'PAIRED' as const, pairingId: PAIRING.pairingId },
    };

    /** Priya's phone after her session ended: profile, last state and the pairing's owner kept, token gone. */
    async function sessionEnded(): Promise<void> {
      await signedIn(h);
      await h.authStore.saveLastState(PAIRED_ACTIVE);
      await h.pairingStore.save(PAIRING);
      await h.authStore.setPairingOwnerUserId('u1');
      await h.authStore.clearSession();
      h.waiting.count = 2;
    }

    /** Priya's phone after a log out: the account set gone, the pairing and its owner kept (R9.5). */
    async function loggedOut(): Promise<void> {
      await sessionEnded();
      await h.authStore.clearForLogout();
    }

    it('the same account: Home with the pairing kept, no question, no code (R9.6)', async () => {
      await sessionEnded();
      h.workerState.mockResolvedValue(PAIRED_ACTIVE);
      renderNavigator(h.deps);
      await waitForRoute('SignIn');
      submitSignIn('priya@example.in');
      await waitForRoute('Home');
      expect(screen.queryByTestId('shell-confirm')).toBeNull();
      expect(h.unpairMe).not.toHaveBeenCalled();
      expect(await h.pairingStore.load()).toEqual(PAIRING);
      expect(await h.authStore.pairingOwnerUserId()).toBe('u1');
      expect(h.waiting.count).toBe(2);
      // The Attendance module is Enabled from the pairing record: no "I have a code".
      fireEvent.click(within(focused()).getByTestId('home-module-attendance'));
      await waitForRoute('Attendance');
      expect(await within(focused()).findByTestId('punch-home')).toBeTruthy();
      expect(within(focused()).queryByTestId('attendance-code')).toBeNull();
    });

    it("a different account, confirmed: the warning names the punches, one unpair call, wipe, then that account's state (R9.7)", async () => {
      await sessionEnded();
      h.signIn.mockResolvedValueOnce({
        userId: 'u2',
        name: 'Ravi Kumar',
        email: 'ravi@example.in',
        phone: '9123456780',
        role: 'WORKER',
        accessToken: 'tok-2',
      });
      h.workerState.mockResolvedValue(stateAnswer({ state: 'NO_SHOP' }));
      renderNavigator(h.deps);
      await waitForRoute('SignIn');
      submitSignIn('ravi@example.in');

      const sheet = await screen.findByTestId('shell-confirm');
      expect(within(sheet).getByRole('heading').textContent).toBe(
        STRINGS_EN['switchAccount.question'],
      );
      expect(within(sheet).getByText(/2 punches that were not yet sent will be lost/)).toBeTruthy();
      // Nothing has happened yet.
      expect(h.unpairMe).not.toHaveBeenCalled();
      expect(await h.pairingStore.load()).toEqual(PAIRING);

      fireEvent.click(screen.getByTestId('shell-confirm-confirm'));
      await waitForRoute('Join');
      expect(within(focused()).getByText('Hello, Ravi Kumar')).toBeTruthy();
      expect(h.unpairMe).toHaveBeenCalledTimes(1);
      expect(await h.pairingStore.load()).toBeNull();
      expect(h.keys.deleted).toBe(1);
      expect(h.waiting.count).toBe(0);
      expect(await h.authStore.profile()).toMatchObject({ userId: 'u2' });
      // The owner went with the pairing (R9.5).
      expect(await h.authStore.pairingOwnerUserId()).toBeNull();
      expect(screen.queryByTestId('shell-confirm')).toBeNull();
    });

    it('a different account, cancelled: nothing stored, the pairing and the queue stay, Sign in remains', async () => {
      await sessionEnded();
      const pairingBefore = (await h.pairingStore.load()) as unknown;
      h.signIn.mockResolvedValueOnce({ ...ACCOUNT, userId: 'u2', accessToken: 'tok-2' });
      renderNavigator(h.deps);
      await waitForRoute('SignIn');
      submitSignIn('ravi@example.in');
      await screen.findByTestId('shell-confirm');
      fireEvent.click(screen.getByTestId('shell-confirm-cancel'));
      await waitFor(() => expect(screen.queryByTestId('shell-confirm')).toBeNull());

      expect(focusedRouteName()).toBe('SignIn');
      expect(h.unpairMe).not.toHaveBeenCalled();
      expect(h.workerState).not.toHaveBeenCalled();
      expect(await h.authStore.accessToken()).toBeNull();
      expect(await h.authStore.profile()).toMatchObject({ userId: 'u1' });
      expect(await h.pairingStore.load()).toEqual(pairingBefore);
      expect(h.waiting.count).toBe(2);
      expect(h.keys.deleted).toBe(0);
    });

    it('after a log out the pairing owner still decides: the same account is not asked, a different one is (R9.5–R9.7)', async () => {
      await loggedOut();
      expect(await h.authStore.profile()).toBeNull();
      expect(await h.authStore.pairingOwnerUserId()).toBe('u1');
      h.workerState.mockResolvedValue(PAIRED_ACTIVE);
      const first = renderNavigator(h.deps);
      await waitForRoute('SignIn');
      expect(within(focused()).queryByTestId('sign-in-session-ended')).toBeNull();

      // Priya again: Home with Attendance Enabled, no question, no code (R9.6).
      submitSignIn('priya@example.in');
      await waitForRoute('Home');
      expect(screen.queryByTestId('shell-confirm')).toBeNull();
      expect(h.unpairMe).not.toHaveBeenCalled();
      expect(await h.pairingStore.load()).toEqual(PAIRING);
      expect(h.waiting.count).toBe(2);
      first.unmount();

      // She logs out again; Ravi signs in: the owner says the pairing is not his (R9.7).
      await h.authStore.clearForLogout();
      h.signIn.mockResolvedValueOnce({
        userId: 'u2',
        name: 'Ravi Kumar',
        email: 'ravi@example.in',
        phone: '9123456780',
        role: 'WORKER',
        accessToken: 'tok-2',
      });
      h.workerState.mockResolvedValue(stateAnswer({ state: 'NO_SHOP' }));
      renderNavigator(h.deps);
      await waitForRoute('SignIn');
      submitSignIn('ravi@example.in');
      const sheet = await screen.findByTestId('shell-confirm');
      expect(within(sheet).getByText(/2 punches that were not yet sent will be lost/)).toBeTruthy();
      fireEvent.click(screen.getByTestId('shell-confirm-confirm'));
      await waitForRoute('Join');
      expect(h.unpairMe).toHaveBeenCalledTimes(1);
      expect(await h.pairingStore.load()).toBeNull();
      expect(await h.authStore.pairingOwnerUserId()).toBeNull();
      expect(h.keys.deleted).toBe(1);
      expect(h.waiting.count).toBe(0);
    });
  });
});
