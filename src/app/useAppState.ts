/**
 * `AppStateMachine.resolve` as the hook the root navigator runs (worker-app design "State
 * machine"; R1.6, R3.10, R6.1, R6.7, R9.3). It owns every read of `GET /hr/worker/me` the shell
 * makes and the two things that follow from an answer:
 *
 * 1. **When**: once at launch, every time the app comes to the foreground (`foreground`), every
 *    time a screen asks (`refresh()`: screen focus, the Waiting screen's 60-second poll, after a
 *    sign-in or a log out), and never twice at once: a `refresh()` while a read is in flight joins
 *    that read instead of starting another (design Property 31 "no two reads overlap").
 * 2. **Storing**: a `state` answer replaces the stored last state (R6.7) and refreshes the stored
 *    profile's `phone` from the answer's `account.phone` (R1.11, DD20: the phone check in
 *    `resolve` reads `stored.accountPhone` when the server is not reachable, so it must be the
 *    last truth); "not authenticated" clears the token and nothing else (R9.3). This is the only
 *    place a 401 is handled: screens hand their errors to {@link ShellActions.handleError} and
 *    draw nothing of their own for it.
 *
 * The stored pairing is read for the record but never routed on (R1.1, D11): whether it belongs to
 * the account signing in is `completeSignIn`'s question (`authStore.pairingOwnerUserId`, R9.6,
 * R9.7), asked before the first resolve.
 *
 * Errors of the reads are turned into answers, not thrown: `NotAuthenticated` → `not_authenticated`,
 * `NotReachable` → `not_reachable`, anything else → `not_reachable` too (the Offline screen offers
 * Retry and Log out, so the worker is never stuck) and reported through `onError`.
 *
 * {@link ShellActions} is what the navigator hands every screen: the hook's three actions plus
 * `confirm`, the shell-level confirm sheet (`src/components/useConfirmSheet.tsx`) that the account
 * switch asks its R9.7 question through; the navigator composes the two.
 *
 * React only; no React Native import, so the file loads under vitest's node environment. The
 * foreground event comes in as a {@link ForegroundSource} (`src/app/foreground.ts` binds
 * `AppState`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { WorkerStateResponse } from '@stockkart/attendance-protocol';

import type { AccountClient } from '../api/accountClient';
import { isNotAuthenticated, isNotReachable } from '../api/transport';
import type { AccountProfile, AuthStore } from '../state/authStore';
import type { PairingRecord } from '../state/pairingStore';
import { resolve, type AppRoute, type ServerAnswer, type StoredRecord } from './AppStateMachine';

/** Unsubscribes a listener. */
export type Unsubscribe = () => void;

/** Tells the hook the app came to the foreground (React Native's `AppState` → `active`). */
export interface ForegroundSource {
  subscribe(listener: () => void): Unsubscribe;
}

/** The part of `AuthStore` the hook uses. */
export type ShellAuthStore = Pick<
  AuthStore,
  'snapshot' | 'saveLastState' | 'clearSession' | 'updateProfile'
>;

/** The part of `PairingStore` the hook uses. */
export interface ShellPairingStore {
  load(): Promise<PairingRecord | null>;
}

export interface AppStateDeps {
  authStore: ShellAuthStore;
  pairingStore: ShellPairingStore;
  /** The Bearer client: the state read. */
  account: Pick<AccountClient, 'workerState'>;
  /** Fires on every return to the foreground. Optional for tests. */
  foreground?: ForegroundSource;
  /** Where unexpected failures go (a refused state read, a store write that failed). */
  onError?: (context: string, error: unknown) => void;
}

export type ShellState =
  | { status: 'resolving' }
  | {
      status: 'ready';
      route: AppRoute;
      /** The signed-in account's profile, or null when signed out. */
      profile: AccountProfile | null;
    };

/** A yes/no question for the shell's confirm sheet (R12.5): the account switch's R9.7 warning. */
export interface ConfirmPrompt {
  question: string;
  explanation?: string;
  confirmLabel: string;
  cancelLabel: string;
}

/** Asks the worker and resolves true on confirm, false on cancel; `ShellActions.confirm`'s shape. */
export type Confirm = (prompt: ConfirmPrompt) => Promise<boolean>;

/** What the hook itself provides; {@link ShellActions} adds the navigator's `confirm`. */
export interface StateActions {
  /**
   * Reads the state again and re-routes. Joins a read already in flight. Resolves when the route
   * is up to date (also when the server was not reachable).
   */
  refresh(): Promise<void>;
  /**
   * A screen already holds a fresh `GET /hr/worker/me`-shaped answer (`POST /leave` returns one):
   * routes from it without another read.
   */
  apply(state: WorkerStateResponse): Promise<void>;
  /**
   * The one place a 401 is handled (R9.3): a `NotAuthenticated` error clears the token, keeps
   * everything else and shows Sign in with the "Your session ended" line. Returns true when the
   * error was that and the shell took over; false when the screen must show it itself.
   */
  handleError(error: unknown): boolean;
}

/** What screens may ask of the shell. Passed down by the navigator; never imported by a screen. */
export interface ShellActions extends StateActions {
  /**
   * Asks the worker a yes/no question in the shell's confirm sheet, above whatever screen is
   * showing; resolves true on confirm, false on cancel (or when the sheet is dismissed).
   */
  confirm: Confirm;
}

export interface UseAppState extends StateActions {
  state: ShellState;
}

export function useAppState(deps: AppStateDeps): UseAppState {
  const [state, setState] = useState<ShellState>({ status: 'resolving' });
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const inFlight = useRef<Promise<void> | null>(null);
  const live = useRef(true);

  /** One resolution: read the store, ask the server (or take `given`), store, route. */
  const run = useCallback(async (given?: ServerAnswer): Promise<void> => {
    const d = depsRef.current;
    const snapshot = await d.authStore.snapshot();
    const pairing = await d.pairingStore.load().catch((error: unknown) => {
      d.onError?.('pairing store', error);
      return null;
    });
    const stored: StoredRecord = {
      token: snapshot.accessToken,
      accountPhone: snapshot.profile?.phone ?? null,
      lastState: snapshot.lastState,
      pairing,
    };

    let answer: ServerAnswer | undefined = given;
    if (stored.token != null && answer === undefined) {
      answer = await readState(d);
    }

    // Without a token the answer is not looked at; any value will do.
    const resolution = resolve(stored, answer ?? { kind: 'not_reachable' });
    const route = resolution.route;

    let profile = snapshot.profile;
    if (stored.token != null && answer?.kind === 'not_authenticated') {
      await d.authStore
        .clearSession()
        .catch((error: unknown) => d.onError?.('clear session', error));
    } else if (answer?.kind === 'state' && resolution.stored.lastState) {
      await d.authStore
        .saveLastState(resolution.stored.lastState)
        .catch((error: unknown) => d.onError?.('save last state', error));
      // The answer's `account.phone` is the truth about the account (R1.11, DD20): the stored
      // profile follows it, so an offline resolve reads the right `accountPhone`.
      const phone = resolution.stored.accountPhone ?? undefined;
      if (profile != null && (profile.phone ?? undefined) !== phone) {
        profile = await d.authStore.updateProfile({ phone }).catch((error: unknown) => {
          d.onError?.('save account phone', error);
          return profile;
        });
      }
    }

    if (live.current) {
      setState({
        status: 'ready',
        route,
        profile: resolution.stored.token == null ? null : profile,
      });
    }
  }, []);

  /** Runs one resolution at a time; a call during a run joins that run. */
  const resolveOnce = useCallback(
    (given?: ServerAnswer): Promise<void> => {
      if (inFlight.current) {
        return inFlight.current;
      }
      const promise = run(given)
        .catch((error: unknown) => {
          depsRef.current.onError?.('resolve', error);
          // A store failure must not leave the splash up forever: the worker can sign in again.
          if (live.current) {
            setState({
              status: 'ready',
              route: { name: 'SignedOut', sessionEnded: false },
              profile: null,
            });
          }
        })
        .finally(() => {
          inFlight.current = null;
        });
      inFlight.current = promise;
      return promise;
    },
    [run],
  );

  const refresh = useCallback(() => resolveOnce(), [resolveOnce]);

  const apply = useCallback(
    (fresh: WorkerStateResponse) => resolveOnce({ kind: 'state', state: fresh }),
    [resolveOnce],
  );

  const handleError = useCallback(
    (error: unknown): boolean => {
      if (!isNotAuthenticated(error)) {
        return false;
      }
      void resolveOnce({ kind: 'not_authenticated' });
      return true;
    },
    [resolveOnce],
  );

  // Launch.
  useEffect(() => {
    live.current = true;
    void resolveOnce();
    return () => {
      live.current = false;
    };
  }, [resolveOnce]);

  // Foreground.
  useEffect(() => {
    const source = deps.foreground;
    if (!source) {
      return undefined;
    }
    return source.subscribe(() => {
      void resolveOnce();
    });
  }, [deps.foreground, resolveOnce]);

  return useMemo(
    () => ({ state, refresh, apply, handleError }),
    [state, refresh, apply, handleError],
  );
}

// --- the read ---

/** `GET /hr/worker/me` as a {@link ServerAnswer}; never throws. */
async function readState(d: AppStateDeps): Promise<ServerAnswer> {
  try {
    return { kind: 'state', state: await d.account.workerState() };
  } catch (error) {
    if (isNotAuthenticated(error)) {
      return { kind: 'not_authenticated' };
    }
    if (!isNotReachable(error)) {
      d.onError?.('worker state', error);
    }
    return { kind: 'not_reachable' };
  }
}
