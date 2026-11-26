// Task 14.9 — Property 31 (Waiting polls and follows the answer; R3.10, R10.4): for any sequence
// of state answers under a fake clock, while the Waiting screen is mounted a state read happens at
// least every 60 s and on every foreground event, the route follows the latest answer within one
// tick (APPROVED → Home, REJECTED / WITHDRAWN → Join carrying the outcome for the rejection card,
// not reachable → Offline with the pending state kept), no read happens once the Waiting screen is
// gone, and no two reads overlap.
//
// The pieces under test are the real ones: `WaitingScreen` (its `usePolling` tick calls
// `shell.refresh()`), `useAppState` (owns every read, joins a read in flight, resolves the route
// through `AppStateMachine.resolve`) and `appStateForeground` (React Native's `AppState` →
// foreground event). Only the navigator is replaced: a mini shell mounts `WaitingScreen` for the
// `Waiting` route and a marker for any other, which is what `RootNavigator` does with its route
// groups. The server is a script: PENDING for the launch read, PENDING n more times, then one final
// answer, repeated for any read that should not have happened.
//
// Time passes one timer at a time, each inside its own `act`, so the render a tick or a finished
// read causes is committed before the next timer fires, as on a phone where a commit takes a frame
// and the next tick is up to a minute away. A reference list of the instants at which a read must
// start (every 60 s since the screen mounted; every background → active transition) is kept
// alongside and compared with the server's log.
import { act, cleanup, render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { useEffect, useMemo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  JoinRequestOutcome,
  WorkerAccount,
  WorkerStateResponse,
} from '@stockkart/attendance-protocol';

import { harness, PROFILE, REQUEST } from '../../test-support/join-harness';
import { emitAppState, type AppStateStatus } from '../../test-support/react-native-dom';
import { NotReachable } from '../api/transport';
import type { AppRoute } from '../app/AppStateMachine';
import { appStateForeground } from '../app/foreground';
import {
  useAppState,
  type AppStateDeps,
  type ShellActions,
  type ShellAuthStore,
  type ShellPairingStore,
} from '../app/useAppState';
import type { AuthSnapshot, StoredWorkerState, WorkerStateLike } from '../state/authStore';
import { staticTheme, ThemeContext } from '../theme';
import { WAITING_POLL_MS } from './usePolling';
import { WaitingScreen } from './WaitingScreen';

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// `useAppState` → `AppStateMachine` → `authStore.ts`, which binds the secure store and expo-crypto
// at module load; the shell stores here are in-memory fakes.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'EXPO-UUID' }));

const NUM_RUNS = 60;
// 2025-05-12 09:00 UTC
const START = Date.UTC(2025, 4, 12, 9, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------
// The server's answers
// ---------------------------------------------------------------------------------------------

type FinalKind = 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'not_reachable';

type Answer = { kind: 'state'; state: WorkerStateResponse } | { kind: 'not_reachable' };

const ACCOUNT: WorkerAccount = { ...PROFILE, role: 'WORKER' };

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

const PENDING: Answer = {
  kind: 'state',
  state: stateAnswer({ state: 'PENDING', request: REQUEST }),
};

const APPROVED: Answer = {
  kind: 'state',
  state: stateAnswer({
    state: 'ACTIVE',
    shop: { shopId: 's1', shopName: REQUEST.shopName },
    employee: {
      employeeId: 'e1',
      code: 'EMP-015',
      name: PROFILE.name,
      joinDate: '2025-05-12',
      status: 'ACTIVE',
    },
    modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
    pairing: { state: 'NOT_PAIRED' },
  }),
};

function decided(outcome: JoinRequestOutcome): Answer {
  return { kind: 'state', state: stateAnswer({ state: 'NO_SHOP', lastOutcome: outcome }) };
}

/** The outcome the server sends once the request was rejected or withdrawn (R4.12). */
const outcome: fc.Arbitrary<JoinRequestOutcome> = fc.record({
  id: fc.constant(REQUEST.id),
  status: fc.constantFrom<'REJECTED' | 'WITHDRAWN'>('REJECTED', 'WITHDRAWN'),
  shopName: fc.constant(REQUEST.shopName),
  reason: fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.stringMatching(/^[A-Za-z][A-Za-z .]{0,29}$/),
  ),
  decidedAt: fc.constant('2025-05-12T10:00:00Z'),
});

interface Final {
  kind: FinalKind;
  answer: Answer;
  outcome: JoinRequestOutcome | null;
}

const finalAnswer: fc.Arbitrary<Final> = fc.oneof(
  fc.constant<Final>({ kind: 'APPROVED', answer: APPROVED, outcome: null }),
  outcome.map((o): Final => ({ kind: o.status, answer: decided(o), outcome: o })),
  fc.constant<Final>({ kind: 'not_reachable', answer: { kind: 'not_reachable' }, outcome: null }),
);

/** How many reads after the launch one still answer PENDING before the final answer. */
const pendingPolls = fc.integer({ min: 0, max: 3 });

/** PENDING for the launch read, `polls` more, then the final answer. */
function scriptOf(polls: number, final: Final): Answer[] {
  return [PENDING, ...Array<Answer>(polls).fill(PENDING), final.answer];
}

// ---------------------------------------------------------------------------------------------
// What happens on the phone meanwhile
// ---------------------------------------------------------------------------------------------

type Step = { kind: 'wait'; ms: number } | { kind: 'appState'; status: AppStateStatus };

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc
      .integer({ min: 1, max: WAITING_POLL_MS * 2 + 30_000 })
      .map((ms): Step => ({ kind: 'wait', ms })),
  },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom<AppStateStatus>('background', 'inactive', 'active')
      .map((status): Step => ({ kind: 'appState', status })),
  },
);

const steps = fc.array(step, { maxLength: 8 });

// ---------------------------------------------------------------------------------------------
// The scripted server
// ---------------------------------------------------------------------------------------------

interface ReadLog {
  startedAt: number;
  endedAt: number | null;
}

interface Server {
  workerState: () => Promise<WorkerStateResponse>;
  reads: ReadLog[];
  /** The most reads ever in flight at once. */
  maxInFlight: number;
}

/**
 * Answers `script` in order and repeats the last entry for every further read; each read takes
 * `latencyMs` of fake time (0: the promise settles in the same tick).
 */
function scriptedServer(script: readonly Answer[], latencyMs: number): Server {
  const reads: ReadLog[] = [];
  let inFlight = 0;
  const server: Server = {
    reads,
    maxInFlight: 0,
    async workerState() {
      const index = reads.length;
      const log: ReadLog = { startedAt: Date.now(), endedAt: null };
      reads.push(log);
      inFlight += 1;
      server.maxInFlight = Math.max(server.maxInFlight, inFlight);
      if (latencyMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, latencyMs);
        });
      }
      inFlight -= 1;
      log.endedAt = Date.now();
      const answer = script[Math.min(index, script.length - 1)];
      if (answer.kind === 'not_reachable') {
        throw new NotReachable('TIMEOUT');
      }
      return answer.state;
    },
  };
  return server;
}

// ---------------------------------------------------------------------------------------------
// The mini shell
// ---------------------------------------------------------------------------------------------

interface Stores {
  authStore: ShellAuthStore;
  pairingStore: ShellPairingStore;
  lastState(): StoredWorkerState | null;
}

/** A signed-in phone whose last stored state is `initial`, without a pairing. */
function stores(initial: StoredWorkerState): Stores {
  let lastState: StoredWorkerState | null = initial;
  const authStore: ShellAuthStore = {
    async snapshot(): Promise<AuthSnapshot> {
      return {
        accessToken: 'tok',
        profile: PROFILE,
        lastState,
        dismissedOutcomeId: null,
        themeOverride: 'system',
        pairingOwnerUserId: null,
      };
    },
    async saveLastState(state: WorkerStateLike) {
      lastState = state as StoredWorkerState;
    },
    async clearSession() {
      throw new Error('clearSession must not be called: no answer here says not authenticated');
    },
    async updateProfile() {
      // Every answer carries the profile's own phone, so the hook has nothing to refresh (DD20).
      throw new Error('updateProfile must not be called: the account phone never changes here');
    },
  };
  const pairingStore: ShellPairingStore = {
    async load() {
      return null;
    },
  };
  return { authStore, pairingStore, lastState: () => lastState };
}

interface MiniShellProps {
  shellDeps: AppStateDeps;
  screenDeps: ReturnType<typeof harness>['deps'];
  onRoute: (route: AppRoute) => void;
}

/** `RootNavigator` reduced to what Property 31 needs: Waiting is real, every other route a marker. */
function MiniShell({ shellDeps, screenDeps, onRoute }: MiniShellProps) {
  const app = useAppState(shellDeps);
  const { refresh, apply, handleError } = app;
  const shell = useMemo<ShellActions>(
    () => ({ refresh, apply, handleError, confirm: async () => true }),
    [refresh, apply, handleError],
  );
  const route = app.state.status === 'ready' ? app.state.route : null;
  useEffect(() => {
    if (route) {
      onRoute(route);
    }
  }, [route, onRoute]);

  if (route == null) {
    return <div data-testid="shell-resolving" />;
  }
  if (route.name === 'Waiting') {
    return <WaitingScreen deps={screenDeps} shell={shell} state={route.state} />;
  }
  return <div data-testid={`route-${route.name}`} />;
}

interface Mounted {
  server: Server;
  /** One entry per resolution the shell committed, in order. */
  routes: AppRoute[];
  stored: Stores;
  /** What the shell reported through `onError`; always expected empty. */
  errors: string[];
  unmount: () => void;
}

const STORED_PENDING: StoredWorkerState = {
  state: 'PENDING',
  modules: [],
  request: REQUEST,
  serverTime: '2025-05-12T09:00:00Z',
};

/** Mounts the shell at `START`, lets the launch read settle and checks Waiting is on screen. */
async function mountWaiting(script: readonly Answer[], latencyMs: number): Promise<Mounted> {
  vi.setSystemTime(START);
  // `appStateForeground` reads the current app state when it subscribes; a run before may have
  // left it in the background.
  emitAppState('active');
  const server = scriptedServer(script, latencyMs);
  const stored = stores(STORED_PENDING);
  const screenDeps = harness().deps;
  const routes: AppRoute[] = [];
  const errors: string[] = [];
  const shellDeps: AppStateDeps = {
    authStore: stored.authStore,
    pairingStore: stored.pairingStore,
    account: { workerState: server.workerState },
    foreground: appStateForeground,
    onError: (context, error) => {
      errors.push(`${context}: ${String(error)}`);
    },
  };
  const view = render(
    <ThemeContext.Provider value={staticTheme('light')}>
      <MiniShell
        shellDeps={shellDeps}
        screenDeps={screenDeps}
        onRoute={(route) => {
          routes.push(route);
        }}
      />
    </ThemeContext.Provider>,
  );
  await pass(latencyMs);
  expect(screen.getByTestId('screen-waiting')).toBeTruthy();
  expect(server.reads).toHaveLength(1);
  return { server, routes, stored, errors, unmount: view.unmount };
}

/**
 * Advances the fake clock by `ms`, one timer per `act`, so what a timer sets off (the read's
 * promise chain, the render, the effects) is committed before the next timer fires. A sentinel
 * timer at the target keeps the clock from jumping past it.
 */
async function pass(ms: number): Promise<void> {
  const target = Date.now() + ms;
  setTimeout(() => undefined, ms);
  do {
    await act(async () => {
      await vi.advanceTimersToNextTimerAsync();
    });
  } while (Date.now() < target);
}

/** React Native tells the app it is now `status`; the shell's foreground listener may read. */
async function appState(status: AppStateStatus): Promise<void> {
  await act(async () => {
    emitAppState(status);
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** The route the final answer must lead to, and what it must carry (design "State machine"). */
function expectFollowed(mounted: Mounted, final: Final): void {
  const last = mounted.routes[mounted.routes.length - 1];
  expect(screen.queryByTestId('screen-waiting')).toBeNull();
  switch (final.kind) {
    case 'APPROVED':
      expect(last).toMatchObject({ name: 'Home', offline: false, state: { state: 'ACTIVE' } });
      expect(screen.getByTestId('route-Home')).toBeTruthy();
      expect(mounted.stored.lastState()?.state).toBe('ACTIVE');
      break;
    case 'REJECTED':
    case 'WITHDRAWN':
      // The Join screen draws the rejection card from `state.lastOutcome` (R4.12).
      expect(last).toMatchObject({ name: 'Join', state: { state: 'NO_SHOP' } });
      expect(last.name === 'Join' ? last.state.lastOutcome : undefined).toEqual(final.outcome);
      expect(screen.getByTestId('route-Join')).toBeTruthy();
      expect(mounted.stored.lastState()?.lastOutcome).toEqual(final.outcome);
      break;
    case 'not_reachable':
      // Waiting needs the server (R6.1, R6.7): Offline with Retry; the pending state is kept.
      expect(last).toEqual({ name: 'Offline' });
      expect(screen.getByTestId('route-Offline')).toBeTruthy();
      expect(mounted.stored.lastState()).toEqual(STORED_PENDING);
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Property 31
// ---------------------------------------------------------------------------------------------

describe('Feature: worker-app, Property 31: Waiting polls and follows the answer', () => {
  it('for any run of PENDING answers, final answer and foreground flips, a read starts every 60 s and on every foreground event, the route follows each answer at once, and nothing reads after the final one (R3.10, R10.4)', async () => {
    await fc.assert(
      fc.asyncProperty(pendingPolls, finalAnswer, steps, async (polls, final, plan) => {
        const script = scriptOf(polls, final);
        const mounted = await mountWaiting(script, 0);
        try {
          // The reference: when a read must start. The launch read is the first; the screen
          // mounted in the same instant, so the ticks are anchored there.
          const expectedStarts = [START];
          let nextTick = START + WAITING_POLL_MS;
          let previous: AppStateStatus = 'active';
          const answered = () => expectedStarts.length >= script.length;
          const tickUntil = (target: number) => {
            while (!answered() && nextTick <= target) {
              expectedStarts.push(nextTick);
              nextTick += WAITING_POLL_MS;
            }
          };
          const startsSoFar = () => mounted.server.reads.map((read) => read.startedAt);

          for (const s of plan) {
            if (answered()) {
              break;
            }
            if (s.kind === 'wait') {
              tickUntil(Date.now() + s.ms);
              await pass(s.ms);
            } else {
              if (s.status === 'active' && previous !== 'active') {
                expectedStarts.push(Date.now());
              }
              previous = s.status;
              await appState(s.status);
            }
            expect(startsSoFar()).toEqual(expectedStarts);
            // The route follows every answer within the same tick: one route per read, all of
            // them Waiting until the final one.
            expect(mounted.routes).toHaveLength(mounted.server.reads.length);
            if (!answered()) {
              expect(mounted.routes.every((route) => route.name === 'Waiting')).toBe(true);
              expect(screen.getByTestId('screen-waiting')).toBeTruthy();
            }
          }

          // Left alone on the Waiting screen, the poll gets to the final answer by itself.
          while (!answered()) {
            tickUntil(Date.now() + WAITING_POLL_MS);
            await pass(WAITING_POLL_MS);
            expect(startsSoFar()).toEqual(expectedStarts);
          }

          expect(mounted.routes).toHaveLength(script.length);
          expect(mounted.routes.slice(0, -1).every((route) => route.name === 'Waiting')).toBe(true);
          expectFollowed(mounted, final);

          // No poll after the answer: the Waiting screen is gone, and with it its timer.
          await pass(WAITING_POLL_MS * 5);
          expect(startsSoFar()).toEqual(expectedStarts);
          expect(mounted.server.maxInFlight).toBe(1);
          expect(mounted.errors).toEqual([]);
        } finally {
          mounted.unmount();
          cleanup();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  }, 120_000);

  it('for any read latency, even longer than the interval, and any flips, no two reads overlap, the screen never idles 60 s without a read, and the answer is still followed', async () => {
    const latency = fc.integer({ min: 1, max: WAITING_POLL_MS + 30_000 });
    const decidedFinal = finalAnswer.filter((final) => final.kind !== 'not_reachable');
    await fc.assert(
      fc.asyncProperty(
        pendingPolls,
        decidedFinal,
        steps,
        latency,
        async (polls, final, plan, latencyMs) => {
          const script = scriptOf(polls, final);
          const mounted = await mountWaiting(script, latencyMs);
          try {
            const { reads } = mounted.server;
            const answered = () =>
              reads.length >= script.length && reads[reads.length - 1].endedAt != null;

            for (const s of plan) {
              if (answered()) {
                break;
              }
              if (s.kind === 'wait') {
                await pass(s.ms);
              } else {
                await appState(s.status);
              }
            }
            // Left alone, the poll gets to the final answer: each pass completes one read.
            for (let i = 0; i <= polls + 1 && !answered(); i += 1) {
              await pass(WAITING_POLL_MS + latencyMs);
            }
            // The final read's commit, when it ended on the last timer of a pass.
            await pass(0);

            expect(mounted.server.maxInFlight).toBe(1);
            for (let i = 0; i < reads.length; i += 1) {
              const read = reads[i];
              // Each read took the latency, and the next one started only after it ended.
              expect(read.endedAt).toBe(read.startedAt + latencyMs);
              if (i > 0) {
                const before = reads[i - 1].endedAt ?? Number.POSITIVE_INFINITY;
                expect(read.startedAt).toBeGreaterThanOrEqual(before);
                // Never 60 s on the Waiting screen without a read in flight or starting.
                expect(read.startedAt - before).toBeLessThanOrEqual(WAITING_POLL_MS);
              }
            }
            // Exactly the script's reads: ticks and foreground events that fell on a read in
            // flight joined it instead of adding one, and nothing read after the answer.
            expect(reads).toHaveLength(script.length);
            expect(mounted.routes).toHaveLength(script.length);
            expectFollowed(mounted, final);
            expect(mounted.errors).toEqual([]);
          } finally {
            mounted.unmount();
            cleanup();
          }
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);
});
