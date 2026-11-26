/**
 * What the hardware back button does on each route (worker-app R6.8; design Property 16): the
 * app's one rule, applied by the one `BackHandler` in `RootNavigator`.
 *
 * - **Home** and every route before it (`SignIn`, `CreateAccount`, `Join`, `Waiting`, `Blocked`,
 *   `Offline`, and `PhoneAndPhoto` when the `NeedsPhone` group has it) → leave the app (`exit`):
 *   there is nothing to go back to inside it.
 * - A module root (`Attendance`, `History`, `Profile`) → `Home`.
 * - A sub-screen → its parent: `EditDetails`, `CompleteProfile` → `Profile`; `Pair` →
 *   `Attendance`; `Consent` → `Pair`; `PhoneAndPhoto` in the `SignedOut` group → `CreateAccount`
 *   (the Create account screen opened it, or Sign in did and Create account is the screen with the
 *   same Google button; either way the popped-to route is in the mounted group).
 *
 * `PhoneAndPhoto` is the one route whose back depends on the **group** the navigator has mounted
 * (`routes.ts`): the Google sign-up's phone step has a parent; the "Add your phone number" step of
 * a signed-in account without a phone (R1.11, DD20) is a pre-Home root with Log out as its only
 * other control, so back leaves the app and never reaches Home. Hence `backAction(route, group)`.
 *
 * The relation has no cycle: following it from any route reaches `exit` in at most four steps
 * (`Consent` → `Pair` → `Attendance` → `Home` → `exit`), so back never traps the worker.
 *
 * Pure: no React, Expo or React Native import.
 */
import { ROUTES, type RouteGroup, type RouteName } from './routes';

/** Leave the app. */
export const EXIT = 'exit' as const;

export type BackAction = typeof EXIT | RouteName;

/** The routes whose back leaves the app in every group: Home and everything before it. */
export const EXIT_ROUTES: readonly RouteName[] = [
  ROUTES.Home,
  ROUTES.SignIn,
  ROUTES.CreateAccount,
  ROUTES.Join,
  ROUTES.Waiting,
  ROUTES.Blocked,
  ROUTES.Offline,
];

/** The module roots: back goes to Home. */
export const MODULE_ROUTES: readonly RouteName[] = [
  ROUTES.Attendance,
  ROUTES.History,
  ROUTES.Profile,
];

/** Sub-screens and their parent (the `SignedOut` parent of `PhoneAndPhoto` included). */
export const PARENT_OF: Readonly<Partial<Record<RouteName, RouteName>>> = {
  [ROUTES.EditDetails]: ROUTES.Profile,
  [ROUTES.CompleteProfile]: ROUTES.Profile,
  [ROUTES.Pair]: ROUTES.Attendance,
  [ROUTES.Consent]: ROUTES.Pair,
  [ROUTES.PhoneAndPhoto]: ROUTES.CreateAccount,
};

/** The routes whose back depends on the mounted group, and the group in which it is `exit`. */
export const EXIT_IN_GROUP: Readonly<Partial<Record<RouteName, RouteGroup>>> = {
  [ROUTES.PhoneAndPhoto]: 'NeedsPhone',
};

/**
 * Where back goes from `route` while `group` is mounted: `exit`, or the route to show. Total over
 * every {@link RouteName} and {@link RouteGroup}.
 */
export function backAction(route: RouteName, group: RouteGroup): BackAction {
  if (EXIT_ROUTES.includes(route)) {
    return EXIT;
  }
  if (MODULE_ROUTES.includes(route)) {
    return ROUTES.Home;
  }
  if (own(EXIT_IN_GROUP, route) === group) {
    return EXIT;
  }
  const parent = own(PARENT_OF, route);
  if (parent !== undefined) {
    return parent;
  }
  // Every route is in one of the three lists; a name this version does not know leaves the app
  // rather than trapping the worker on it.
  return EXIT;
}

/** Own keys only: a name such as `toString` must not reach `Object.prototype`. */
function own<T>(table: Readonly<Partial<Record<RouteName, T>>>, route: RouteName): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, route) ? table[route] : undefined;
}

/**
 * The routes back passes through from `route` in `group` until it leaves the app, `route` first and
 * `exit` last. Finite for every route because the relation has no cycle; a cycle would be a bug and
 * throws here so the property test catches it.
 */
export function backPath(route: RouteName, group: RouteGroup): BackAction[] {
  const path: BackAction[] = [route];
  let current: BackAction = route;
  while (current !== EXIT) {
    const next: BackAction = backAction(current, group);
    if (path.includes(next)) {
      throw new Error(`back from ${route} cycles at ${next}`);
    }
    path.push(next);
    current = next;
  }
  return path;
}
