/**
 * Route names and params of the app's one stack (worker-app design "Screen inventory", R6.8).
 * Shared by `RootNavigator`, `backAction` and every screen that navigates, so a route name is
 * spelled once.
 *
 * The routes fall into groups the state machine (`AppStateMachine.resolve`) chooses between; the
 * navigator mounts one group at a time, and React Navigation resets to the group's first route when
 * the group changes:
 *
 * | Group        | Routes                                                                        |
 * | ------------ | ----------------------------------------------------------------------------- |
 * | `SignedOut`  | `SignIn`, `CreateAccount`, `PhoneAndPhoto` (`mode: 'signup'`)                 |
 * | `NeedsPhone` | `PhoneAndPhoto` (`mode: 'update'`; R1.11, DD20)                               |
 * | `Join`       | `Join`                                                                        |
 * | `Waiting`    | `Waiting`                                                                     |
 * | `Blocked`    | `Blocked`                                                                     |
 * | `Offline`    | `Offline`                                                                     |
 * | `Home`       | `Home`, `Attendance`, `History`, `Profile`, `EditDetails`, `CompleteProfile`, `Pair`, `Consent` |
 *
 * `PhoneAndPhoto` is the one route two groups mount: in `SignedOut` as the Google sign-up's phone
 * step (from Create account, or from Sign in when the server answers `OAUTH_ACCOUNT_NOT_FOUND`,
 * R1.10), in `NeedsPhone` as the "Add your phone number" step of a signed-in account without a
 * phone (R1.11). `backAction(route, group)` tells the two apart (R6.8).
 *
 * `Pair` and `Consent` are the HR-module pairing screens, reached from the Attendance module's
 * "I have a code" (R7.1–R7.2); their params are the ones `ConsentScreen` declares. Nothing is
 * reachable before Sign in or Create account completes (R1.1).
 */
import type { AppRouteName } from '../app/AppStateMachine';
import type { ConsentRouteParams } from '../screens/ConsentScreen';

export const ROUTES = {
  // Signed out
  SignIn: 'SignIn',
  CreateAccount: 'CreateAccount',
  PhoneAndPhoto: 'PhoneAndPhoto',
  // Before Home
  Join: 'Join',
  Waiting: 'Waiting',
  Blocked: 'Blocked',
  Offline: 'Offline',
  // Home and its modules
  Home: 'Home',
  Attendance: 'Attendance',
  History: 'History',
  Profile: 'Profile',
  EditDetails: 'EditDetails',
  CompleteProfile: 'CompleteProfile',
  Pair: 'Pair',
  Consent: 'Consent',
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];

/** Every route name, in the order of the table above. */
export const ROUTE_NAMES: readonly RouteName[] = Object.values(ROUTES);

export function isRouteName(value: unknown): value is RouteName {
  return typeof value === 'string' && (ROUTE_NAMES as readonly string[]).includes(value);
}

/**
 * The route group the navigator has mounted (`AppStateMachine.resolve`'s route name). `backAction`
 * needs it for the one route two groups share, `PhoneAndPhoto`.
 */
export type RouteGroup = AppRouteName;

/** Every route group, in the order of the table above. */
export const ROUTE_GROUPS: readonly RouteGroup[] = [
  'SignedOut',
  'NeedsPhone',
  'Join',
  'Waiting',
  'Blocked',
  'Offline',
  'Home',
];

export function isRouteGroup(value: unknown): value is RouteGroup {
  return typeof value === 'string' && (ROUTE_GROUPS as readonly string[]).includes(value);
}

/**
 * `PhoneAndPhoto`'s params, one shape per mode (design "Google sign-in without an account, and the
 * phone step"; R1.4, R1.10, R1.11, R1.13):
 *
 * - `signup`: the Google sign-up's phone step. `idToken` is the ID token Google gave, held here and
 *   in the screen's state only (never stored, R1.13) and sent once with the phone to
 *   `POST /auth/signup`; `name` and `email` are the token's claims, for display only.
 * - `update`: a signed-in account without a phone (`NeedsPhone`): nothing to carry, the name comes
 *   from the stored profile.
 */
export type PhoneAndPhotoParams =
  | { mode: 'signup'; idToken: string; name: string; email?: string }
  | { mode: 'update' };

export type PhoneAndPhotoMode = PhoneAndPhotoParams['mode'];

/** Params per route; `undefined` means the route takes none. */
export type RootStackParamList = {
  SignIn: undefined;
  CreateAccount: undefined;
  PhoneAndPhoto: PhoneAndPhotoParams;
  Join: undefined;
  Waiting: undefined;
  Blocked: undefined;
  Offline: undefined;
  Home: undefined;
  Attendance: undefined;
  History: undefined;
  Profile: undefined;
  EditDetails: undefined;
  CompleteProfile: undefined;
  Pair: undefined;
  Consent: ConsentRouteParams;
};
