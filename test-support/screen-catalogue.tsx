/**
 * Every worker-app screen in a representative state, built with fakes, for the two tests that
 * render the whole app and assert one rule across it (task 15.2):
 *
 * - `src/i18n/pseudo.test.tsx`: every label survives the 40 %-longer pseudo-locale (R12.11);
 * - `src/components/primaryButtonCount.test.tsx`: at most one `PrimaryButton` per screen (R12.5).
 *
 * The fakes are the ones the screen tests use (`join-harness.ts` and the `*.test.tsx` next to each
 * screen), trimmed
 * to what a first render needs. `ready()` resolves once the screen has settled into the state the
 * entry names (the Attendance module reads the pairing store before it draws, Profile reads the
 * server profile, …). The Attendance module draws the real check-in screen (`PunchScreen`, DD17)
 * in both of its states over scripted `/me`, queue and signer fakes.
 *
 * The test files must mock `react-native-safe-area-context`, `expo-secure-store`, `expo-crypto`,
 * `expo-haptics` (the check-in screen's haptics) and `@react-navigation/native` (`useFocusEffect`)
 * before importing this module; `vi.mock` is file-scoped, so it cannot live here.
 */
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import type {
  AppStatusResponse,
  PunchResponse,
  WorkerProfileResponse,
} from '@stockkart/attendance-protocol';

import type { PhotoModules, PickedImage } from '../src/account/photo';
import { CreateAccountScreen } from '../src/account/CreateAccountScreen';
import { OfflineScreen } from '../src/account/OfflineScreen';
import { PhoneAndPhotoScreen } from '../src/account/PhoneAndPhotoScreen';
import { SignInScreen } from '../src/account/SignInScreen';
import { NotAuthenticated } from '../src/api/transport';
import type { AppDeps } from '../src/app/deps';
import type { PairingEnded } from '../src/app/pairingEnded';
import type { ShellActions } from '../src/app/useAppState';
import { HistoryCache } from '../src/history/HistoryCache';
import { WorkerHomeScreen } from '../src/home/HomeScreen';
import { t } from '../src/i18n';
import { BlockedScreen } from '../src/join/BlockedScreen';
import { JoinShopScreen } from '../src/join/JoinShopScreen';
import { WaitingScreen } from '../src/join/WaitingScreen';
import { AttendanceModule } from '../src/modules/AttendanceModule';
import { HistoryModule } from '../src/modules/HistoryModule';
import { CompleteProfileScreen } from '../src/profile/CompleteProfileScreen';
import { EditDetailsScreen } from '../src/profile/EditDetailsScreen';
import { ProfileScreen } from '../src/profile/ProfileScreen';
import { MemoryDatabase } from '../src/queue/memoryDb';
import type { QueueState } from '../src/queue/SyncWorker';
import { AuthStore, type StoredAccount, type StoredWorkerState } from '../src/state/authStore';
import type { CachedNotification } from '../src/state/NotificationsCache';
import type { PairingRecord, SecureStorage } from '../src/state/pairingStore';
import { harness as joinHarness, PROFILE, REQUEST, SHOP } from './join-harness';

export interface ScreenCase {
  /** `Screen · state`, for the test name. */
  name: string;
  /** Builds the element with fresh fakes; render it with `renderThemed`. */
  element: () => ReactElement;
  /** Resolves once the screen shows the state the entry names. */
  ready: () => Promise<unknown>;
  /** How many `PrimaryButton`s the design gives this state (R12.5). */
  primaryButtons: 0 | 1;
}

// --- shared fakes ---

/** 2025-05-12 14:30 IST. */
const NOW = Date.UTC(2025, 4, 12, 9, 0, 0);

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

function shellActions(): ShellActions {
  return {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn((error: unknown) => error instanceof NotAuthenticated),
    confirm: vi.fn(async () => true),
  };
}

const ACCOUNT: StoredAccount = {
  ...PROFILE,
  photoUrl: '/api/v1/users/u1/photo',
  accessToken: 'tok',
};

const PICKED: PickedImage = { uri: 'file:///cache/o.jpg', width: 800, height: 800 };

function photoModules(): PhotoModules {
  return {
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
}

const PAIRING: PairingRecord = {
  pairingId: '66f1a2b3c4d5e6f708192a3b',
  shopId: 's1',
  employeeId: 'e1',
  employeeName: 'Priya Sharma',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: false },
  consentVersion: 1,
};

const ME: AppStatusResponse = {
  employeeName: 'Priya Sharma',
  shopName: 'Sri Ganesh Stores',
  today: '2025-05-12',
  biometricApp: true,
  canPunch: true,
  reason: null,
  nextDirection: 'IN',
  todayIn: null,
  todayOut: null,
  location: { locationCheck: false },
  consent: { latestVersion: 1, reconsentRequired: false, agreedVersion: 1 },
};

const NO_SHOP: StoredWorkerState = { state: 'NO_SHOP', modules: [] };

const REJECTED: StoredWorkerState = {
  ...NO_SHOP,
  lastOutcome: {
    id: 'o1',
    status: 'REJECTED',
    shopName: SHOP.shopName,
    reason: 'Ask Ramesh to add you',
    decidedAt: '2025-05-11T10:00:00Z',
  },
};

const PENDING: StoredWorkerState = { state: 'PENDING', modules: [], request: REQUEST };

const ACTIVE: StoredWorkerState = {
  state: 'ACTIVE',
  shop: { shopId: 's1', shopName: SHOP.shopName },
  employee: {
    employeeId: 'e1',
    code: 'EMP-015',
    name: 'Priya Sharma',
    joinDate: '2025-04-03',
    status: 'ACTIVE',
  },
  modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
  pairing: { state: 'NOT_PAIRED' },
  today: { date: '2025-05-12', in: '09:12', out: null, nextDirection: 'OUT' },
};

const UNREAD: CachedNotification[] = [
  {
    id: 'n1',
    text: 'Sri Ganesh Stores accepted you',
    type: 'JOIN_REQUEST_APPROVED',
    createdAt: '2025-05-12T08:00:00Z',
    read: false,
  },
];

const SERVER_PROFILE: WorkerProfileResponse = {
  name: 'Priya Sharma',
  phone: '9876543210',
  email: 'priya@example.in',
  photoUrl: '/api/v1/users/u1/photo',
  shopName: SHOP.shopName,
  employeeCode: 'EMP-015',
  joinDate: '2025-04-03',
  profileRequested: false,
  pairingState: 'PAIRED',
};

function punch(id: string, at: string): PunchResponse {
  return {
    id,
    employeeId: 'e1',
    at,
    source: 'BIOMETRIC_APP',
    direction: 'IN',
    flags: [],
    counted: true,
  };
}

// --- per-screen builders ---

function accountDeps(overrides: Record<string, unknown> = {}): AppDeps {
  const authStore = new AuthStore({ storage: memoryStorage() });
  const account = {
    signIn: vi.fn(async () => ACCOUNT),
    signInWithGoogle: vi.fn(async () => ACCOUNT),
    createAccount: vi.fn(async () => ACCOUNT),
    createAccountWithGoogle: vi.fn(async () => ACCOUNT),
    uploadPhoto: vi.fn(),
    logout: vi.fn(async () => ({ success: true })),
  };
  const googleSignIn = {
    getIdToken: vi.fn(async () => ({ kind: 'id_token' as const, idToken: 'g' })),
  };
  const pairingStore = {
    load: vi.fn<() => Promise<PairingRecord | null>>(async () => null),
    wipe: vi.fn(async () => undefined),
  };
  return {
    authStore,
    account,
    googleSignIn,
    openUrl: vi.fn(async () => undefined),
    pairingStore,
    client: { unpairMe: vi.fn(async () => ({ unpaired: true })) },
    queue: { waitingCount: vi.fn(async () => 0) },
    photo: photoModules(),
    ...overrides,
  } as unknown as AppDeps;
}

function signIn(sessionEnded: boolean): ScreenCase {
  return {
    name: `SignIn${sessionEnded ? ' · session ended' : ''}`,
    element: () => (
      <SignInScreen
        deps={accountDeps()}
        shell={shellActions()}
        sessionEnded={sessionEnded}
        onCreateAccount={vi.fn()}
        onGoogleNeedsSignup={vi.fn()}
      />
    ),
    ready: () => screen.findByTestId('screen-sign-in'),
    primaryButtons: 1,
  };
}

const createAccount: ScreenCase = {
  name: 'CreateAccount',
  element: () => (
    <CreateAccountScreen
      deps={accountDeps()}
      shell={shellActions()}
      onSignInInstead={vi.fn()}
      onGoogleNeedsPhone={vi.fn()}
    />
  ),
  ready: () => screen.findByTestId('screen-create-account'),
  primaryButtons: 1,
};

const phoneAndPhoto: ScreenCase = {
  name: 'PhoneAndPhoto · signup',
  element: () => (
    <PhoneAndPhotoScreen
      deps={accountDeps()}
      shell={shellActions()}
      params={{ mode: 'signup', idToken: 'google-id-token', name: 'Ramesh' }}
      onBack={vi.fn()}
    />
  ),
  ready: () => screen.findByTestId('screen-phone-and-photo'),
  primaryButtons: 1,
};

/** The `NeedsPhone` route (R1.11): "Add your phone number", Save, Log out; no Back. */
const phoneAndPhotoUpdate: ScreenCase = {
  name: 'PhoneAndPhoto · update',
  element: () => (
    <PhoneAndPhotoScreen
      deps={accountDeps()}
      shell={shellActions()}
      params={{ mode: 'update' }}
      profile={{ ...PROFILE, phone: undefined }}
    />
  ),
  ready: () => screen.findByTestId('phone-photo-log-out'),
  primaryButtons: 1,
};

const offline: ScreenCase = {
  name: 'Offline',
  element: () => <OfflineScreen deps={accountDeps()} shell={shellActions()} />,
  ready: () => screen.findByTestId('screen-offline'),
  primaryButtons: 1,
};

function join(state: StoredWorkerState, label: string): ScreenCase {
  return {
    name: `Join · ${label}`,
    element: () => {
      const h = joinHarness();
      return <JoinShopScreen deps={h.deps} shell={h.shell} state={state} profile={PROFILE} />;
    },
    ready: () =>
      state.lastOutcome ? screen.findByTestId('join-outcome') : screen.findByTestId('screen-join'),
    primaryButtons: 1,
  };
}

function waiting(state: StoredWorkerState, label: string): ScreenCase {
  return {
    name: `Waiting · ${label}`,
    element: () => {
      const h = joinHarness({ unread: UNREAD });
      return <WaitingScreen deps={h.deps} shell={h.shell} state={state} />;
    },
    ready: () => screen.findByTestId('waiting-banners-n1'),
    primaryButtons: 0,
  };
}

function blocked(kind: 'staff_no_employee'): ScreenCase {
  return {
    name: `Blocked · ${kind}`,
    element: () => {
      const h = joinHarness();
      return <BlockedScreen deps={h.deps} shell={h.shell} kind={kind} />;
    },
    ready: () => screen.findByTestId('screen-blocked'),
    primaryButtons: 0,
  };
}

function home(state: StoredWorkerState, isOffline: boolean, label: string): ScreenCase {
  return {
    name: `Home · ${label}`,
    element: () => {
      const h = joinHarness({ unread: UNREAD });
      return (
        <WorkerHomeScreen
          deps={h.deps}
          shell={h.shell}
          state={state}
          profile={PROFILE}
          offline={isOffline}
          onOpenModule={vi.fn()}
          now={() => NOW}
        />
      );
    },
    ready: () => screen.findByTestId('home-banners-n1'),
    primaryButtons: 0,
  };
}

function punchDeps(record: PairingRecord | null, me: AppStatusResponse | Error = ME): AppDeps {
  let stored = record;
  const listeners = new Set<(ended: PairingEnded) => void>();
  return {
    pairingStore: {
      load: vi.fn(async () => stored),
      isPaired: vi.fn(async () => stored !== null),
      wipe: vi.fn(async () => {
        stored = null;
      }),
      updateLocation: vi.fn(async () => undefined),
      updateConsentVersion: vi.fn(async () => undefined),
    },
    client: {
      getMe: vi.fn(async () => {
        if (me instanceof Error) {
          throw me;
        }
        return me;
      }),
      getLatestConsent: vi.fn(async () => {
        throw new Error('not asked');
      }),
      postConsent: vi.fn(async (version: number) => ({ agreedVersion: version })),
      unpairMe: vi.fn(async () => ({ unpaired: true })),
    },
    punchFlow: {
      run: vi.fn(async () => {
        throw new Error('no punch in the catalogue');
      }),
    },
    sync: {
      subscribe: vi.fn((listener: (state: QueueState) => void) => {
        listener({ waiting: 0, refused: [], newestDirection: null });
        return () => undefined;
      }),
      dismissRefused: vi.fn(async () => true),
    },
    signer: { capability: vi.fn(async () => 'STRONG_BIOMETRIC_READY' as const) },
    clock: () => NOW,
    onPairingEnded: vi.fn((listener: (ended: PairingEnded) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as unknown as AppDeps;
}

/**
 * Both states draw the check-in screen (`PunchScreen`, DD17): Not enabled with the muted button,
 * the code card and **I have a code**; Enabled with the full screen once `/me` has answered (the
 * punch button replaces the spinner).
 */
function attendance(record: PairingRecord | null): ScreenCase {
  return {
    name: `Attendance · ${record ? 'enabled' : 'not enabled'}`,
    element: () => (
      <AttendanceModule
        deps={punchDeps(record)}
        shell={shellActions()}
        state={ACTIVE}
        onHaveCode={vi.fn()}
        onBack={vi.fn()}
      />
    ),
    ready: async () => {
      await screen.findByTestId(record ? 'attendance-enabled' : 'attendance-not-enabled');
      await screen.findByTestId('punch-button');
      if (record) {
        // The chips have read the store and the signer (no network): "Fingerprint ready".
        await screen.findByText(t('punch.biometricReady'));
      }
    },
    primaryButtons: record ? 0 : 1,
  };
}

const history: ScreenCase = {
  name: 'History',
  element: () => {
    const deps = {
      account: {
        history: vi.fn(async () => [
          punch('a', '2025-05-10T04:05:00Z'),
          punch('b', '2025-05-12T03:40:00Z'),
        ]),
      },
      historyCache: new HistoryCache(new MemoryDatabase(), { now: () => NOW }),
      pairingStore: { wipe: vi.fn(async () => undefined) },
    } as unknown as AppDeps;
    return <HistoryModule deps={deps} shell={shellActions()} onBack={vi.fn()} now={() => NOW} />;
  },
  ready: () => screen.findByTestId('history-row-b'),
  primaryButtons: 0,
};

function profile(server: Partial<WorkerProfileResponse>, label: string): ScreenCase {
  return {
    name: `Profile · ${label}`,
    element: () => {
      const deps = {
        account: {
          profile: vi.fn(async () => ({ ...SERVER_PROFILE, ...server })),
          leaveShop: vi.fn(),
          logout: vi.fn(async () => ({ success: true })),
          imageSource: vi.fn(async (photoUrl: string) => ({
            uri: `https://api.test.invalid${photoUrl}`,
            headers: { Authorization: 'Bearer tok' },
          })),
        },
        client: { unpairMe: vi.fn(async () => ({ unpaired: true })) },
        pairingStore: { isPaired: vi.fn(async () => true), wipe: vi.fn(async () => undefined) },
        authStore: { clearForLogout: vi.fn(async () => undefined) },
        appVersion: '1.2.0 (34)',
      } as unknown as AppDeps;
      return (
        <ProfileScreen
          deps={deps}
          shell={shellActions()}
          state={{ ...ACTIVE, pairing: { state: 'PAIRED', pairingId: 'p1' } }}
          profile={ACCOUNT}
          onEditDetails={vi.fn()}
          onCompleteProfile={vi.fn()}
        />
      );
    },
    ready: async () => {
      await screen.findByTestId('profile-remove-phone');
      if (server.profileRequested) {
        await screen.findByTestId('profile-requested-badge');
      }
    },
    primaryButtons: 1,
  };
}

const editDetails: ScreenCase = {
  name: 'EditDetails',
  element: () => (
    <EditDetailsScreen
      deps={accountDeps({
        account: {
          updateProfile: vi.fn(),
          uploadPhoto: vi.fn(),
          deletePhoto: vi.fn(),
          imageSource: vi.fn(async (photoUrl: string) => ({
            uri: `https://api.test.invalid${photoUrl}`,
            headers: { Authorization: 'Bearer tok' },
          })),
        },
      })}
      shell={shellActions()}
      profile={ACCOUNT}
      onDone={vi.fn()}
    />
  ),
  ready: () => screen.findByTestId('screen-edit-details'),
  primaryButtons: 1,
};

const completeProfile: ScreenCase = {
  name: 'CompleteProfile',
  element: () => <CompleteProfileScreen onBack={vi.fn()} />,
  ready: () => screen.findByTestId('screen-complete-profile'),
  primaryButtons: 1,
};

/** Every worker-app screen, each in the states the design's screen inventory names. */
export const SCREEN_CASES: readonly ScreenCase[] = [
  signIn(false),
  signIn(true),
  createAccount,
  phoneAndPhoto,
  phoneAndPhotoUpdate,
  offline,
  join(NO_SHOP, 'no shop'),
  join(REJECTED, 'rejected'),
  waiting(PENDING, 'pending request'),
  blocked('staff_no_employee'),
  home(ACTIVE, false, 'active'),
  home({ ...ACTIVE, modules: [...ACTIVE.modules, 'PAYSLIPS'] }, true, 'offline, unknown module'),
  attendance(null),
  attendance(PAIRING),
  history,
  profile({}, 'paired'),
  profile({ profileRequested: true }, 'details requested'),
  editDetails,
  completeProfile,
];
