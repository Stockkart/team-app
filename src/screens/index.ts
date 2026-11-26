/**
 * The screens `RootNavigator` mounts, one export per route of `navigation/routes.ts` (worker-app
 * task 13.4). The account screens (`src/account`, task 14.1), the join, waiting and blocked
 * screens (`src/join`, task 14.2), Home, the module registry and the Attendance and History
 * modules (`src/home`, `src/modules`, task 14.3) and Profile, Edit details and Complete your
 * profile (`src/profile`, task 14.4) are all real; the route names and props are the ones
 * `RootNavigator` was built on.
 *
 * The HR-module screens keep their exports: `Pair` and `Consent` are the Stockkart Team app's pairing
 * screens too (R7.2, over `WorkerPairingClient`, with the account's names through `identity`);
 * the punch home is the Enabled state of the Attendance module (R7.1); the history list is the
 * body of `HistoryModule` (R7.9); the settings screen is no longer mounted (Profile holds "Remove
 * this phone", R7.7) but stays exported for its tests.
 */

// --- Stockkart Team routes (tasks 14.1–14.4) ---
export type { ShellScreenProps } from '../app/screenProps';
export { SignInScreen, type SignInScreenProps } from '../account/SignInScreen';
export { CreateAccountScreen, type CreateAccountScreenProps } from '../account/CreateAccountScreen';
export { PhoneAndPhotoScreen, type PhoneAndPhotoScreenProps } from '../account/PhoneAndPhotoScreen';
export { OfflineScreen, type OfflineScreenProps } from '../account/OfflineScreen';
export { JoinShopScreen, type JoinShopScreenProps } from '../join/JoinShopScreen';
export { WaitingScreen, type WaitingScreenProps } from '../join/WaitingScreen';
export { BlockedScreen, type BlockedScreenProps } from '../join/BlockedScreen';
export { WorkerHomeScreen, type WorkerHomeScreenProps } from '../home/HomeScreen';
export { AttendanceModule, type AttendanceModuleProps } from '../modules/AttendanceModule';
export { HistoryModule, type HistoryModuleProps } from '../modules/HistoryModule';
export { ProfileScreen, type ProfileScreenProps } from '../profile/ProfileScreen';
export { EditDetailsScreen, type EditDetailsScreenProps } from '../profile/EditDetailsScreen';
export {
  CompleteProfileScreen,
  type CompleteProfileScreenProps,
} from '../profile/CompleteProfileScreen';

// --- HR-module screens (pairing; the punch home and history list behind the modules) ---
export { PAIR_ROUTE, PairScreen } from './PairScreen';
export type { PairRouteParams, PairingConsentParams } from './PairScreen';
export { CONSENT_HEADINGS, CONSENT_ROUTE, ConsentScreen, PAIRED_TITLE } from './ConsentScreen';
export type { ConsentRouteParams } from './ConsentScreen';
export {
  DUPLICATE_PUNCH,
  HISTORY_FROM_CACHE,
  HistoryScreen,
  lastUpdatedLine,
} from './HistoryScreen';
export type { HistoryScreenDeps, HistoryScreenProps } from './HistoryScreen';
export { REMOVE_PHONE, REMOVE_PHONE_CONFIRM, SettingsScreen } from './SettingsScreen';
export type { SettingsScreenDeps, SettingsScreenProps } from './SettingsScreen';
