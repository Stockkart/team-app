import { describe, expect, it } from 'vitest';

import {
  EXIT,
  EXIT_IN_GROUP,
  EXIT_ROUTES,
  MODULE_ROUTES,
  PARENT_OF,
  backAction,
  backPath,
} from './backAction';
import { ROUTE_GROUPS, ROUTE_NAMES, ROUTES, type RouteGroup, type RouteName } from './routes';

describe('backAction (R6.8)', () => {
  it.each<RouteName>([
    ROUTES.Home,
    ROUTES.SignIn,
    ROUTES.CreateAccount,
    ROUTES.Join,
    ROUTES.Waiting,
    ROUTES.Blocked,
    ROUTES.Offline,
  ])('%s → exit, in every group', (route) => {
    for (const group of ROUTE_GROUPS) {
      expect(backAction(route, group)).toBe(EXIT);
    }
  });

  it.each<RouteName>([ROUTES.Attendance, ROUTES.History, ROUTES.Profile])('%s → Home', (route) => {
    expect(backAction(route, 'Home')).toBe(ROUTES.Home);
  });

  it.each<[RouteName, RouteName, RouteGroup]>([
    [ROUTES.EditDetails, ROUTES.Profile, 'Home'],
    [ROUTES.CompleteProfile, ROUTES.Profile, 'Home'],
    [ROUTES.Pair, ROUTES.Attendance, 'Home'],
    [ROUTES.Consent, ROUTES.Pair, 'Home'],
    [ROUTES.PhoneAndPhoto, ROUTES.CreateAccount, 'SignedOut'],
  ])('%s → its parent %s (in the %s group)', (route, parent, group) => {
    expect(backAction(route, group)).toBe(parent);
  });

  it('PhoneAndPhoto depends on the group: a sub-screen when signed out, a pre-Home root in NeedsPhone (R1.11, R6.8)', () => {
    expect(backAction(ROUTES.PhoneAndPhoto, 'SignedOut')).toBe(ROUTES.CreateAccount);
    expect(backAction(ROUTES.PhoneAndPhoto, 'NeedsPhone')).toBe(EXIT);
    expect(backPath(ROUTES.PhoneAndPhoto, 'SignedOut')).toEqual([
      ROUTES.PhoneAndPhoto,
      ROUTES.CreateAccount,
      EXIT,
    ]);
    expect(backPath(ROUTES.PhoneAndPhoto, 'NeedsPhone')).toEqual([ROUTES.PhoneAndPhoto, EXIT]);
    // Never Home from the phone step.
    for (const group of ROUTE_GROUPS) {
      expect(backPath(ROUTES.PhoneAndPhoto, group)).not.toContain(ROUTES.Home);
    }
    expect(EXIT_IN_GROUP).toEqual({ [ROUTES.PhoneAndPhoto]: 'NeedsPhone' });
  });

  it('covers every route exactly once across the three lists', () => {
    const listed = [...EXIT_ROUTES, ...MODULE_ROUTES, ...Object.keys(PARENT_OF)].sort();
    expect(listed).toEqual([...ROUTE_NAMES].sort());
    // Every group-dependent route also has a parent for the other groups.
    for (const route of Object.keys(EXIT_IN_GROUP) as RouteName[]) {
      expect(PARENT_OF[route]).toBeDefined();
    }
  });

  it('reaches exit from every route in every group without a cycle, in at most four steps', () => {
    for (const group of ROUTE_GROUPS) {
      for (const route of ROUTE_NAMES) {
        const path = backPath(route, group);
        expect(path[0]).toBe(route);
        expect(path[path.length - 1]).toBe(EXIT);
        expect(path.length).toBeLessThanOrEqual(5);
      }
    }
    expect(backPath(ROUTES.Consent, 'Home')).toEqual([
      ROUTES.Consent,
      ROUTES.Pair,
      ROUTES.Attendance,
      ROUTES.Home,
      EXIT,
    ]);
  });
});
