// Task 13.6, updated by task 22.2 — Property 16 (Hardware back never traps, R6.8): for any route
// and route group, `backAction(route, group)` is `exit` for `Home` and every pre-Home route
// (`SignIn`, `CreateAccount`, `Join`, `Waiting`, `Blocked`, `Offline`, and `PhoneAndPhoto` in the
// `NeedsPhone` group), `Home` for every module root (`Attendance`, `History`, `Profile`), and the
// parent route for every sub-screen (including `PhoneAndPhoto` in the `SignedOut` group); the
// relation has no cycle, so pressing back repeatedly always leaves the app and no screen traps the
// worker.
//
// The expected target of every route is written out here as a table, independently of
// `EXIT_ROUTES`, `MODULE_ROUTES`, `PARENT_OF` and `EXIT_IN_GROUP`, and typed
// `Record<RouteName, …>` so adding a route without deciding where its back goes fails to typecheck.
// The one group-dependent route is a function of the group in that table. Acyclicity is checked by
// iterating `backAction` directly (not through `backPath`, which is itself under test), bounded by
// the number of routes: a chain longer than that must revisit a route.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { EXIT, backAction, backPath, type BackAction } from './backAction';
import {
  ROUTE_GROUPS,
  ROUTE_NAMES,
  ROUTES,
  isRouteGroup,
  isRouteName,
  type RouteGroup,
  type RouteName,
} from './routes';

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

/** Any route of the app's one stack. */
const route: fc.Arbitrary<RouteName> = fc.constantFrom(...ROUTE_NAMES);

/** Any group the navigator can have mounted (`AppStateMachine.resolve`'s route names). */
const group: fc.Arbitrary<RouteGroup> = fc.constantFrom(...ROUTE_GROUPS);

/** A route name this version of the app does not know (a newer build's screen, a typo). */
const unknownName: fc.Arbitrary<string> = fc
  .oneof(
    fc.string({ maxLength: 20 }),
    fc.stringMatching(/^[A-Z][A-Za-z]{2,15}$/),
    route.map((name) => `${name}2`),
    route.map((name) => name.toLowerCase()),
  )
  .filter((name) => !isRouteName(name));

/** A group name this version does not know. */
const unknownGroup: fc.Arbitrary<string> = fc
  .oneof(
    fc.string({ maxLength: 20 }),
    group.map((name) => name.toLowerCase()),
  )
  .filter((name) => !isRouteGroup(name));

// ---------------------------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------------------------

/**
 * Where back goes from each route, as R6.8 and the design's screen inventory state it. The one
 * route two groups mount, `PhoneAndPhoto`, depends on which: the Google sign-up's phone step (the
 * `SignedOut` group) has Create account behind it; the "Add your phone number" step of a signed-in
 * account (the `NeedsPhone` group, R1.11) is a pre-Home root and leaves the app.
 */
const EXPECTED_BACK: Record<RouteName, BackAction | ((group: RouteGroup) => BackAction)> = {
  // Home and everything before it leave the app.
  Home: EXIT,
  SignIn: EXIT,
  CreateAccount: EXIT,
  Join: EXIT,
  Waiting: EXIT,
  Blocked: EXIT,
  Offline: EXIT,
  // Module roots go to Home.
  Attendance: ROUTES.Home,
  History: ROUTES.Home,
  Profile: ROUTES.Home,
  // Sub-screens go to their parent.
  EditDetails: ROUTES.Profile,
  CompleteProfile: ROUTES.Profile,
  Pair: ROUTES.Attendance,
  Consent: ROUTES.Pair,
  PhoneAndPhoto: (mounted) => (mounted === 'NeedsPhone' ? EXIT : ROUTES.CreateAccount),
};

function expectedBack(name: RouteName, mounted: RouteGroup): BackAction {
  const entry = EXPECTED_BACK[name];
  return typeof entry === 'function' ? entry(mounted) : entry;
}

/**
 * The groups the navigator mounts each route in (`routes.ts`). Only one group is mounted at a
 * time, so a back target in another group would be a screen that is not there.
 */
const GROUPS_OF: Record<RouteName, readonly RouteGroup[]> = {
  SignIn: ['SignedOut'],
  CreateAccount: ['SignedOut'],
  PhoneAndPhoto: ['SignedOut', 'NeedsPhone'],
  Join: ['Join'],
  Waiting: ['Waiting'],
  Blocked: ['Blocked'],
  Offline: ['Offline'],
  Home: ['Home'],
  Attendance: ['Home'],
  History: ['Home'],
  Profile: ['Home'],
  EditDetails: ['Home'],
  CompleteProfile: ['Home'],
  Pair: ['Home'],
  Consent: ['Home'],
};

/** Every route is in at least one group, and every group has at least one route. */
const ROUTES_OF_GROUP = (mounted: RouteGroup): RouteName[] =>
  ROUTE_NAMES.filter((name) => GROUPS_OF[name].includes(mounted));

/** A route together with a group that mounts it: the pairs the navigator can actually show. */
const mountedRoute: fc.Arbitrary<{ name: RouteName; mounted: RouteGroup }> = route.chain((name) =>
  fc.constantFrom(...GROUPS_OF[name]).map((mounted) => ({ name, mounted })),
);

/** The longest chain the design allows: `Consent → Pair → Attendance → Home → exit`. */
const MAX_PRESSES = 4;

/**
 * Press back from `start` in `mounted` until the app is left, following `backAction` only. Gives
 * up after one step more than there are routes: by then some route must have been visited twice.
 */
function pressUntilExit(start: RouteName, mounted: RouteGroup): BackAction[] {
  const visited: BackAction[] = [start];
  let current: BackAction = start;
  for (let presses = 0; presses <= ROUTE_NAMES.length && current !== EXIT; presses += 1) {
    current = backAction(current, mounted);
    visited.push(current);
  }
  return visited;
}

// ---------------------------------------------------------------------------------------------
// Property 16
// ---------------------------------------------------------------------------------------------

describe('Feature: worker-app, Property 16: Hardware back never traps', () => {
  it('for any route and group, back leaves the app from Home and every pre-Home route (PhoneAndPhoto in NeedsPhone included), goes to Home from every module root, and to the parent from every sub-screen (R6.8)', () => {
    fc.assert(
      fc.property(route, group, (name, mounted) => {
        expect(backAction(name, mounted)).toBe(expectedBack(name, mounted));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any route and group, the relation has no cycle: pressing back repeatedly leaves the app within four presses, visiting no route twice', () => {
    fc.assert(
      fc.property(route, group, (name, mounted) => {
        const visited = pressUntilExit(name, mounted);

        expect(visited[0]).toBe(name);
        expect(visited[visited.length - 1]).toBe(EXIT);
        expect(new Set(visited).size).toBe(visited.length);
        expect(visited.length - 1).toBeLessThanOrEqual(MAX_PRESSES);
        // Every hop is one press, and nothing is ever its own back target.
        for (let i = 0; i < visited.length - 1; i += 1) {
          const from = visited[i] as RouteName;
          expect(backAction(from, mounted)).toBe(visited[i + 1]);
          expect(backAction(from, mounted)).not.toBe(from);
        }
        // `backPath` reports the same chain and does not throw for any route.
        expect(backPath(name, mounted)).toEqual(visited);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any route in a group that mounts it, back stays in that group or leaves the app; from the Home group it passes through Home, from every other group it never reaches Home', () => {
    fc.assert(
      fc.property(mountedRoute, ({ name, mounted }) => {
        const target = backAction(name, mounted);
        if (target !== EXIT) {
          expect(ROUTES_OF_GROUP(mounted)).toContain(target);
        }
        if (mounted === 'Home') {
          expect(pressUntilExit(name, mounted)).toContain(ROUTES.Home);
        } else {
          expect(pressUntilExit(name, mounted)).not.toContain(ROUTES.Home);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any group, every pre-Home group has exactly its roots leaving the app at once: the NeedsPhone group is one screen whose back is exit (R1.11)', () => {
    fc.assert(
      fc.property(group, (mounted) => {
        const roots = ROUTES_OF_GROUP(mounted).filter((name) => backAction(name, mounted) === EXIT);
        expect(roots.length).toBeGreaterThanOrEqual(1);
        if (mounted === 'NeedsPhone') {
          expect(ROUTES_OF_GROUP(mounted)).toEqual([ROUTES.PhoneAndPhoto]);
          expect(roots).toEqual([ROUTES.PhoneAndPhoto]);
        }
        if (mounted === 'Home') {
          expect(roots).toEqual([ROUTES.Home]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('for any name that is not a route this version knows, in any group (known or not), back leaves the app rather than trapping the worker', () => {
    fc.assert(
      fc.property(unknownName, fc.oneof(group, unknownGroup), (name, mounted) => {
        expect(backAction(name as RouteName, mounted as RouteGroup)).toBe(EXIT);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
