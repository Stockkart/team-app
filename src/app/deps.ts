/**
 * Composition root: the one place that binds the app's pure modules to their Expo adapters. Screens
 * receive these objects through `RootNavigator` and never import `expo-*` themselves, so each screen
 * is testable with fakes. Importing this file needs the React Native runtime; tests build the same
 * shapes from `FakeBiometricSigner`, `MemoryDatabase` and in-memory storage instead.
 *
 * `pairingStore.wipe()` is given every deleter it composes (R9.6): the hardware keys, the SQLite
 * queue file and the Stockkart Team app's `pairingOwnerUserId` (worker-app R9.5: it goes with the pairing).
 *
 * Offline queue (R6): the `PunchQueue` and the `HistoryCache` share one lazily opened SQLite file
 * (`lazyQueueDatabase`); a `SyncWorker` is built over them with the phone's triggers
 * (`expoTriggers`: NetInfo, `AppState`, the background task) and started here, so queued punches
 * are sent from the moment the app process is up, whatever screen is showing. A worker stops for
 * good once the server ends its pairing (R3.3), so the `SyncSupervisor` owns it and spawns a fresh
 * one at that moment; screens and `PunchFlow` talk to the supervisor. `expoTriggers` must be
 * imported at start-up because it defines the background task at module scope (Expo's rule); this
 * file's import of it is that start-up import.
 *
 * `PunchFlow` gets the queue, the reachability probe (`serverReachability`: NetInfo, then `GET
 * /me`) and `onQueued` → `SyncWorker.queueChanged()`, which publishes the new queue state to the
 * home screen within the same tick (R6.16) and asks for a send attempt.
 *
 * Stockkart Team (worker-app design DD16, R9.1, R9.2): the account layer is the second half of the
 * deps. `AuthStore` holds the session in the secure store and empties the history and
 * notifications caches on log out; `AccountClient` is the Bearer client over the same transport
 * rules as `AppClient` but never an envelope header; `googleSignIn` returns Google ID tokens only;
 * `workerPairingFlow` is the HR-module `PairingFlow` over `WorkerPairingClient`, so a signed-in
 * worker redeems a code on `/hr/worker/pairings/*` with the token (R7.2), and over
 * `ownedPairingStore`, so a completed pairing records which account made it (R9.5–R9.7); `photo`
 * is the picker and
 * manipulator behind the profile photo (R1.7); `openUrl` opens the web's password reset page in the
 * browser; `foreground` is the `AppState` event the shell re-resolves on.
 */
import { Linking } from 'react-native';

import { AccountClient } from '../api/accountClient';
import { AppClient } from '../api/appClient';
import { expoRandomUUID, expoSha256 } from '../api/expoCrypto';
import { API_URL } from '../config';
import { readDeviceInfo } from '../device/deviceInfo';
import { HistoryCache } from '../history/HistoryCache';
import { expoLocationProvider } from '../location/expoLocation';
import { LocationReader } from '../location/LocationReader';
import { ownedPairingStore } from '../pairing/ownedPairingStore';
import { PairingFlow } from '../pairing/PairingFlow';
import { WorkerPairingClient } from '../pairing/WorkerPairingClient';
import { netInfoConnected } from '../punch/expoNetwork';
import { PunchFlow } from '../punch/PunchFlow';
import { serverReachability } from '../punch/reachability';
import { deleteQueueDatabase, lazyQueueDatabase } from '../queue/expoDb';
import { expoTriggers } from '../queue/expoTriggers';
import { PunchQueue } from '../queue/PunchQueue';
import { SyncSupervisor } from '../queue/SyncSupervisor';
import { SyncWorker, type Unsubscribe } from '../queue/SyncWorker';
import { readAppVersion } from '../settings/appVersion';
import type { BiometricSigner } from '../signer/BiometricSigner';
import { biometricSigner } from '../signer/nativeSigner';
import { AuthStore } from '../state/authStore';
import { NotificationsCache } from '../state/NotificationsCache';
import { PairingStore } from '../state/pairingStore';
import type { GoogleSignIn } from '../account/googleSignIn';
import { nativeGoogleSignIn } from '../account/nativeGoogleSignIn';
import { expoPhotoModules } from '../account/expoPhoto';
import type { PhotoModules } from '../account/photo';
import { appStateForeground } from './foreground';
import type { PairingEnded } from './pairingEnded';
import type { ForegroundSource } from './useAppState';

export interface AppDeps {
  signer: BiometricSigner;
  locationReader: LocationReader;
  pairingStore: PairingStore;
  client: AppClient;
  punchFlow: PunchFlow;
  queue: PunchQueue;
  historyCache: HistoryCache;
  /** The offline queue's sender, kept alive across unpair → re-pair (`SyncSupervisor`). */
  sync: SyncSupervisor;
  /** `app.json` version plus build number, for the settings screen. */
  appVersion: string;
  /**
   * Fires when the sync worker learns, while sending a queued punch, that the pairing is over and
   * has wiped the phone (R3.3). The navigator shows the pairing screen.
   */
  onPairingEnded(listener: (ended: PairingEnded) => void): Unsubscribe;

  // --- Stockkart Team (account layer) ---
  /** The session, profile and last state in the secure store (R9.2). */
  authStore: AuthStore;
  /** The server's last notification list, for the banner stack (R10.1). */
  notificationsCache: NotificationsCache;
  /** The Bearer client: auth, `/hr/worker/**`, `/users/me/*` (R9.1). */
  account: AccountClient;
  /** "Continue with Google": ID token only (DD8). */
  googleSignIn: GoogleSignIn;
  /** The profile photo: square crop, ≤ 512 × 512, JPEG ladder ≤ 300 KB (R1.7). */
  photo: PhotoModules;
  /** Opens a web page in the phone's browser ("Forgot password?" → the web reset page, R1.6). */
  openUrl: (url: string) => Promise<void>;
  /** The HR-module pairing flow over the worker pairing endpoints (R7.2). */
  workerPairingFlow: PairingFlow;
  /** The app came to the foreground: the shell re-resolves (R3.10). */
  foreground: ForegroundSource;
}

/** Builds the app's dependencies once, at start-up, and starts the sync worker. */
export function createAppDeps(): AppDeps {
  const signer = biometricSigner;
  const locationReader = new LocationReader(expoLocationProvider);

  const db = lazyQueueDatabase();
  const queue = new PunchQueue(db);
  const historyCache = new HistoryCache(db);
  const notificationsCache = new NotificationsCache(db);
  const authStore = new AuthStore({
    clearCaches: async () => {
      await historyCache.clear();
      await notificationsCache.clear();
    },
  });

  const pairingStore = new PairingStore({
    randomUUID: expoRandomUUID,
    deleteKeys: () => signer.deleteKeys(),
    deleteQueue: deleteQueueDatabase,
    forgetOwner: () => authStore.clearPairingOwner(),
  });
  const client = new AppClient({
    baseUrl: API_URL,
    signer,
    pairingId: async () => (await pairingStore.load())?.pairingId ?? null,
    sha256: expoSha256,
    randomUUID: expoRandomUUID,
  });
  const device = readDeviceInfo();

  const account = new AccountClient({ baseUrl: API_URL, tokens: authStore });
  const workerPairingFlow = new PairingFlow({
    client: new WorkerPairingClient(account),
    signer,
    store: ownedPairingStore(pairingStore, authStore),
    device,
  });
  const pairingEndedListeners = new Set<(ended: PairingEnded) => void>();
  const sync = new SyncSupervisor({
    create: (onPairingEnded) =>
      new SyncWorker({
        queue,
        client,
        pairingStore,
        triggers: expoTriggers,
        history: historyCache,
        onPairingEnded,
        onError: (error) => console.warn('[attendance] sync worker', error),
      }),
    onPairingEnded: (ended) => {
      for (const listener of pairingEndedListeners) {
        listener(ended);
      }
    },
  });
  void sync.start().catch((error: unknown) => console.warn('[attendance] sync start', error));

  const punchFlow = new PunchFlow({
    client,
    signer,
    locationReader,
    pairingStore,
    reachability: serverReachability({ client, network: netInfoConnected }),
    queue,
    onQueued: () => sync.queueChanged(),
    uuid: expoRandomUUID,
  });

  return {
    signer,
    locationReader,
    pairingStore,
    client,
    punchFlow,
    queue,
    historyCache,
    sync,
    appVersion: readAppVersion(),
    onPairingEnded(listener) {
      pairingEndedListeners.add(listener);
      return () => {
        pairingEndedListeners.delete(listener);
      };
    },
    authStore,
    notificationsCache,
    account,
    googleSignIn: nativeGoogleSignIn,
    photo: expoPhotoModules,
    openUrl: async (url) => {
      await Linking.openURL(url);
    },
    workerPairingFlow,
    foreground: appStateForeground,
  };
}
