import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  BIOMETRIC_REQUIRED,
  KEY_INVALIDATED,
  SAVED_OFFLINE,
  flagSentence,
} from '@stockkart/attendance-protocol';
import type { AppPunchResponse, AppStatusResponse } from '@stockkart/attendance-protocol';

import { adjustsFontSizeToFitOf, styleOf } from '../../test-support/react-native-dom';
import { renderThemed } from '../../test-support/render';
import { tokenNameOf } from '../../test-support/tokens';
import { NotReachable, ServerRefusal } from '../api/appClient';
import { STRINGS_EN, t } from '../i18n';
import type { PunchContext, PunchResult } from '../punch/PunchFlow';
import type { QueuedPunch } from '../queue/PunchQueue';
import type { QueueState } from '../queue/SyncWorker';
import { OFFLINE_NOTICE, REFUSAL_OK } from '../screens/HomeScreen';
import type { BiometricSignerErrorCode, SignerCapability } from '../signer/BiometricSigner';
import type { PairingRecord } from '../state/pairingStore';
import { TOKENS } from '../theme';
import { PunchScreen, type PunchScreenDeps } from './PunchScreen';

// jsdom with `react-native` aliased to DOM elements (vite.config.mts). The focus hook is an effect
// that runs once on mount, which is what a focused screen does; `refocus()` runs it again the way
// the navigator does when the worker comes back to the module (R4.1b).
const focus = vi.hoisted(() => ({ effect: null as (() => void | (() => void)) | null }));
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    focus.effect = effect;
    useEffect(() => effect(), [effect]);
  },
}));
// The kit's barrel pulls in `Screen`, which reads the safe area; the check-in screen draws none.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The phone: "reduce motion" off and the default font scale unless a test says otherwise.
const phone = vi.hoisted(() => ({ reduceMotion: false, fontScale: 1 }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../test-support/react-native-dom')>();
  return {
    ...actual,
    useWindowDimensions: () => ({ width: 360, height: 800, scale: 2, fontScale: phone.fontScale }),
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      isReduceMotionEnabled: () => Promise.resolve(phone.reduceMotion),
    },
  };
});

// The three haptic cues (R12.8), counted.
const haptics = vi.hoisted(() => ({
  punchStored: vi.fn(async () => undefined),
  punchRefused: vi.fn(async () => undefined),
  biometricFailed: vi.fn(async () => undefined),
}));
vi.mock('../theme/haptics', () => haptics);

function refocus(): void {
  act(() => {
    focus.effect?.();
  });
}

const RECORD: PairingRecord = {
  pairingId: '66f1a2b3c4d5e6f708192a3b',
  shopId: '5f1a2b3c4d5e6f7081920001',
  employeeId: '5f1a2b3c4d5e6f7081920002',
  employeeName: 'Ravi Kumar',
  shopName: 'Sharma Stores',
  location: { locationCheck: false },
  consentVersion: 1,
};

const ME: AppStatusResponse = {
  employeeName: 'Ravi Kumar',
  shopName: 'Sharma Stores',
  today: '2025-04-03',
  biometricApp: true,
  canPunch: true,
  reason: null,
  nextDirection: 'IN',
  todayIn: null,
  todayOut: null,
  location: {
    locationCheck: true,
    shopLat: 28.6,
    shopLng: 77.2,
    radiusMetres: 100,
    outsideAction: 'FLAG',
  },
  consent: { latestVersion: 1, reconsentRequired: false, agreedVersion: 1 },
};

/** 2025-04-03 09:12:07 IST. */
const NOW = Date.UTC(2025, 3, 3, 3, 42, 7);

const CHECK_IN = STRINGS_EN['punch.checkIn'];
const CHECK_OUT = STRINGS_EN['punch.checkOut'];

/** A stand-in for the sync worker's state feed: tests push states, the screen reacts. */
class FakeSync {
  private listeners = new Set<(state: QueueState) => void>();
  state: QueueState = { waiting: 0, refused: [], newestDirection: null };
  readonly dismissed: string[] = [];
  subscriptions = 0;

  subscribe(listener: (state: QueueState) => void) {
    this.subscriptions += 1;
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dismissRefused(punchId: string): Promise<boolean> {
    this.dismissed.push(punchId);
    this.publish({
      ...this.state,
      refused: this.state.refused.filter((p) => p.punchId !== punchId),
    });
    return true;
  }

  publish(state: QueueState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

function queued(overrides: Partial<QueuedPunch> = {}): QueuedPunch {
  return {
    punchId: 'a1b2c3d4-0000-4000-8000-000000000001',
    request: {
      pairingId: RECORD.pairingId,
      shopId: RECORD.shopId,
      employeeId: RECORD.employeeId,
      punchId: 'a1b2c3d4-0000-4000-8000-000000000001',
      phoneTime: '2025-04-03T03:42:07Z',
      offline: true,
      locationChecked: false,
      distanceMetres: null,
      accuracyMetres: null,
      mock: false,
      signature: 'sig',
    },
    phoneTime: '2025-04-03T03:42:07Z',
    directionGuess: 'IN',
    state: 'WAITING',
    refusalMessage: null,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 0,
    ...overrides,
  };
}

function stored(lines: string[], response: Partial<AppPunchResponse> = {}): PunchResult {
  return {
    kind: 'stored',
    response: {
      outcome: 'STORED',
      direction: 'IN',
      at: '2025-04-03T03:42:08Z',
      atLocal: '09:12',
      flags: [],
      duplicate: false,
      todayIn: '09:12',
      todayOut: null,
      nextDirection: 'OUT',
      ...response,
    },
    lines,
  };
}

interface Harness {
  deps: PunchScreenDeps;
  getMe: Mock<() => Promise<AppStatusResponse>>;
  run: Mock<(context: PunchContext) => Promise<PunchResult>>;
  load: Mock<() => Promise<PairingRecord | null>>;
  updateLocation: Mock<() => Promise<undefined>>;
  wipe: Mock<() => Promise<undefined>>;
  capability: Mock<() => Promise<SignerCapability>>;
  sync: FakeSync;
  onHaveCode: Mock<() => void>;
  onUnpaired: Mock<() => void>;
  onSignerError: Mock<(code: BiometricSignerErrorCode, message: string) => void>;
}

function harness(
  meAnswers: Array<AppStatusResponse | Error>,
  results: PunchResult[] = [],
  capability: SignerCapability = 'STRONG_BIOMETRIC_READY',
): Harness {
  const getMe = vi.fn(async () => {
    const next = meAnswers.shift();
    if (next === undefined) {
      throw new Error('no scripted /me answer');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  const run = vi.fn(async (_context: PunchContext) => {
    const next = results.shift();
    if (next === undefined) {
      throw new Error('no scripted punch result');
    }
    return next;
  });
  const load = vi.fn(async () => RECORD as PairingRecord | null);
  const updateLocation = vi.fn(async () => undefined);
  const wipe = vi.fn(async () => undefined);
  const cap = vi.fn(async () => capability);
  const sync = new FakeSync();
  return {
    deps: {
      client: { getMe },
      pairingStore: { load, updateLocation, wipe },
      punchFlow: { run },
      sync,
      signer: { capability: cap },
      clock: () => NOW,
    },
    getMe,
    run,
    load,
    updateLocation,
    wipe,
    capability: cap,
    sync,
    onHaveCode: vi.fn<() => void>(),
    onUnpaired: vi.fn<() => void>(),
    onSignerError: vi.fn<(code: BiometricSignerErrorCode, message: string) => void>(),
  };
}

function renderPunch(h: Harness, enabled = true) {
  return renderThemed(
    <PunchScreen
      deps={h.deps}
      enabled={enabled}
      onHaveCode={h.onHaveCode}
      onUnpaired={h.onUnpaired}
      onSignerError={h.onSignerError}
    />,
  );
}

/** The one outcome card under the button. */
function outcomeCard(): HTMLElement {
  return screen.getByTestId('punch-screen-outcome');
}

function expectNoHaptics(): void {
  expect(haptics.punchStored).not.toHaveBeenCalled();
  expect(haptics.punchRefused).not.toHaveBeenCalled();
  expect(haptics.biometricFailed).not.toHaveBeenCalled();
}

afterEach(() => {
  cleanup();
  phone.reduceMotion = false;
  phone.fontScale = 1;
  haptics.punchStored.mockClear();
  haptics.punchRefused.mockClear();
  haptics.biometricFailed.mockClear();
});

describe('PunchScreen, not enabled (R7.1)', () => {
  it('a muted, disabled button over the code card and I have a code; nothing read from the server, queue or signer', async () => {
    const h = harness([]);
    renderPunch(h, false);
    const button = screen.getByRole('button', { name: CHECK_IN });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(tokenNameOf(TOKENS.light, styleOf(button).backgroundColor)).toContain('bgMuted');

    const card = screen.getByTestId('attendance-not-enabled');
    expect(card.textContent).toContain(STRINGS_EN['attendance.notEnabledTitle']);
    expect(card.textContent).toContain(STRINGS_EN['attendance.notEnabledLine']);
    fireEvent.click(screen.getByTestId('attendance-code'));
    expect(h.onHaveCode).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe(
      STRINGS_EN['punch.notCheckedInYet'],
    );
    expect(screen.getByTestId('punch-screen-date').textContent).toBe('Thu, 3 Apr 2025');
    expect(screen.getByTestId('punch-screen-clock').textContent).toBe('09:12:07');
    expect(screen.getByTestId('punch-screen-today-empty').textContent).toBe(
      STRINGS_EN['punch.noCheckInYetToday'],
    );
    expect(screen.getByTestId('punch-screen-chip-location').textContent).toBe('Location off');
    expect(screen.getByTestId('punch-screen-chip-biometric').textContent).toBe('Not set up');

    await act(async () => {
      await Promise.resolve();
    });
    expect(h.getMe).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
    expect(h.capability).not.toHaveBeenCalled();
    expect(h.sync.subscriptions).toBe(0);
    expect(h.run).not.toHaveBeenCalled();
  });
});

describe('PunchScreen, enabled (R7.6, R7.10–R7.13)', () => {
  it('IN next: a success "Check in" button, "Not checked in yet", an empty Today card, no code card; /me read once and the settings stored (R4.1b, R9.3)', async () => {
    const h = harness([ME]);
    renderPunch(h);
    const button = await screen.findByRole('button', { name: CHECK_IN });
    expect(tokenNameOf(TOKENS.light, styleOf(button).backgroundColor)).toContain('success');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe('Not checked in yet');
    expect(screen.getByTestId('punch-screen-today-empty')).toBeTruthy();
    expect(screen.queryByTestId('attendance-not-enabled')).toBeNull();
    expect(screen.queryByTestId('attendance-code')).toBeNull();
    expect(screen.getByTestId('punch-screen-date').textContent).toBe('Thu, 3 Apr 2025');
    expect(h.getMe).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.updateLocation).toHaveBeenCalledWith(ME.location));
    // The one tappable control is the punch button (R4.1).
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('OUT next: a danger "Check out" button, "In since 09:12" and the open row', async () => {
    const h = harness([{ ...ME, nextDirection: 'OUT', todayIn: '09:12' }]);
    renderPunch(h);
    const button = await screen.findByRole('button', { name: CHECK_OUT });
    expect(tokenNameOf(TOKENS.light, styleOf(button).backgroundColor)).toContain('danger');
    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe('In since 09:12');
    expect(screen.getByTestId('punch-screen-today-row-0').getAttribute('aria-label')).toBe(
      'IN 09:12 → OUT —',
    );
    expect(screen.queryByTestId('punch-screen-today-worked')).toBeNull();
  });

  it('done for today: "Done for today · 8 h 53 m", the pair row and the worked footer, IN next again', async () => {
    const h = harness([{ ...ME, nextDirection: 'IN', todayIn: '09:12', todayOut: '18:05' }]);
    renderPunch(h);
    await screen.findByRole('button', { name: CHECK_IN });
    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe(
      'Done for today · 8 h 53 m',
    );
    expect(screen.getByTestId('punch-screen-today-row-0').getAttribute('aria-label')).toBe(
      'IN 09:12 → OUT 18:05',
    );
    expect(screen.getByTestId('punch-screen-today-worked').textContent).toBe('Worked 8 h 53 m');
  });

  it('asks /me again on every focus and takes the direction from that answer (R4.1b)', async () => {
    const h = harness([ME, { ...ME, nextDirection: 'OUT', todayIn: '09:12' }]);
    renderPunch(h);
    await screen.findByRole('button', { name: CHECK_IN });
    refocus();
    expect(await screen.findByRole('button', { name: CHECK_OUT })).toBeTruthy();
    expect(h.getMe).toHaveBeenCalledTimes(2);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('a stored punch: success card with the lines, the ring once, punchStored once, /me again, then the new direction (R7.13)', async () => {
    const after: AppStatusResponse = { ...ME, nextDirection: 'OUT', todayIn: '09:12' };
    const h = harness(
      [ME, after],
      [stored(['Checked in at 09:12', flagSentence('OUTSIDE_SHOP')], { flags: ['OUTSIDE_SHOP'] })],
    );
    renderPunch(h);
    fireEvent.click(await screen.findByRole('button', { name: CHECK_IN }));

    await waitFor(() => expect(outcomeCard().textContent).toContain('Checked in at 09:12'));
    const card = outcomeCard();
    expect(card.textContent).toContain('Outside shop — your manager will see this');
    expect(tokenNameOf(TOKENS.light, styleOf(card).backgroundColor)).toContain('successSoft');
    expect(h.run).toHaveBeenCalledWith({ directionGuess: 'IN' });
    await waitFor(() => expect(h.getMe).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: CHECK_OUT })).toBeTruthy();
    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe('In since 09:12');
    expect(screen.getByTestId('punch-screen-today-row-0').getAttribute('aria-label')).toBe(
      'IN 09:12 → OUT —',
    );
    // The ring is drawn (reduce motion off) and the location chip follows the flag.
    expect(screen.getByTestId('punch-button-ring')).toBeTruthy();
    expect(screen.getByTestId('punch-screen-chip-location').textContent).toBe('Outside shop');
    expect(haptics.punchStored).toHaveBeenCalledTimes(1);
    expect(haptics.punchRefused).not.toHaveBeenCalled();
    expect(haptics.biometricFailed).not.toHaveBeenCalled();
  });

  it('a refusal is a danger card word for word; punchRefused once; nothing else changes (R4.3)', async () => {
    const before: AppStatusResponse = { ...ME, nextDirection: 'OUT', todayIn: '09:12' };
    const message =
      'Your shop has not turned on the Attendance app. Ask your manager to mark your attendance.';
    const h = harness([before], [{ kind: 'refused', message, code: 'HR_APP_OFF' }]);
    renderPunch(h);
    fireEvent.click(await screen.findByRole('button', { name: CHECK_OUT }));
    await waitFor(() => expect(outcomeCard().textContent).toContain(message));
    expect(tokenNameOf(TOKENS.light, styleOf(outcomeCard()).backgroundColor)).toContain(
      'dangerSoft',
    );
    expect(screen.getByRole('button', { name: CHECK_OUT })).toBeTruthy();
    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe('In since 09:12');
    expect(h.getMe).toHaveBeenCalledTimes(1);
    expect(haptics.punchRefused).toHaveBeenCalledTimes(1);
    expect(haptics.punchStored).not.toHaveBeenCalled();
    expect(haptics.biometricFailed).not.toHaveBeenCalled();
  });

  it('a failed biometric check is a warning card with the R5.5 sentence; biometricFailed once; screen otherwise unchanged (R4.2d)', async () => {
    const before: AppStatusResponse = { ...ME, nextDirection: 'OUT', todayIn: '09:12' };
    const h = harness(
      [before],
      [{ kind: 'biometric_required', message: BIOMETRIC_REQUIRED, code: 'BIOMETRIC_CANCELLED' }],
    );
    renderPunch(h);
    fireEvent.click(await screen.findByRole('button', { name: CHECK_OUT }));
    await waitFor(() => expect(outcomeCard().textContent).toContain(BIOMETRIC_REQUIRED));
    expect(tokenNameOf(TOKENS.light, styleOf(outcomeCard()).backgroundColor)).toContain(
      'warningSoft',
    );
    expect(h.getMe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: CHECK_OUT })).toBeTruthy();
    expect(h.wipe).not.toHaveBeenCalled();
    expect(h.onUnpaired).not.toHaveBeenCalled();
    expect(haptics.biometricFailed).toHaveBeenCalledTimes(1);
    expect(haptics.punchStored).not.toHaveBeenCalled();
    expect(haptics.punchRefused).not.toHaveBeenCalled();
  });

  it.each(['KEY_INVALIDATED', 'NO_KEYS'] as const)(
    '%s from the signer shows the message and hands the code to onSignerError (R5.9)',
    async (code) => {
      const message =
        code === 'KEY_INVALIDATED' ? KEY_INVALIDATED : 'No pairing keys exist on this phone.';
      const h = harness([ME], [{ kind: 'signer_error', message, code }]);
      renderPunch(h);
      fireEvent.click(await screen.findByRole('button', { name: CHECK_IN }));
      await waitFor(() => expect(outcomeCard().textContent).toContain(message));
      expect(h.onSignerError).toHaveBeenCalledWith(code, message);
      expect(h.getMe).toHaveBeenCalledTimes(1);
      expect(h.onUnpaired).not.toHaveBeenCalled();
      expectNoHaptics();
    },
  );

  it('HR_APP_NOT_PAIRED from a punch hands over (PunchFlow already wiped)', async () => {
    const h = harness(
      [ME],
      [{ kind: 'unpaired', message: 'This phone is no longer paired. Ask your manager.' }],
    );
    renderPunch(h);
    fireEvent.click(await screen.findByRole('button', { name: CHECK_IN }));
    await waitFor(() => expect(h.onUnpaired).toHaveBeenCalledTimes(1));
    expect(h.wipe).not.toHaveBeenCalled();
    expectNoHaptics();
  });

  it('HR_APP_NOT_PAIRED from /me wipes the phone and hands over', async () => {
    const h = harness([
      new ServerRefusal(403, 'This phone is no longer paired. Ask your manager.'),
    ]);
    renderPunch(h);
    await waitFor(() => expect(h.onUnpaired).toHaveBeenCalledTimes(1));
    expect(h.wipe).toHaveBeenCalledTimes(1);
  });

  it('a /me refusal that is not an unpair is a danger card and the button still works', async () => {
    const h = harness([new ServerRefusal(409, 'Something the server said.')]);
    renderPunch(h);
    await waitFor(() => expect(outcomeCard().textContent).toContain('Something the server said.'));
    expect(screen.getByRole('button', { name: CHECK_IN })).toBeTruthy();
    expect(h.onUnpaired).not.toHaveBeenCalled();
  });

  it('the server\u2019s canPunch = false reason is a warning card', async () => {
    const h = harness([{ ...ME, canPunch: false, reason: 'Your shop is closed today.' }]);
    renderPunch(h);
    const card = await screen.findByTestId('punch-screen-reason');
    expect(card.textContent).toContain('Your shop is closed today.');
    expect(tokenNameOf(TOKENS.light, styleOf(card).backgroundColor)).toContain('warningSoft');
  });

  it('the chips read the store and the signer, never the client: Fingerprint ready, Checking… until a punch tells (R7.12)', async () => {
    const h = harness([ME]);
    renderPunch(h);
    await screen.findByRole('button', { name: CHECK_IN });
    await waitFor(() =>
      expect(screen.getByTestId('punch-screen-chip-biometric').textContent).toBe(
        'Fingerprint ready',
      ),
    );
    expect(screen.getByTestId('punch-screen-chip-biometric').getAttribute('aria-label')).toBe(
      'Biometric: Fingerprint ready',
    );
    expect(screen.getByTestId('punch-screen-chip-location').textContent).toBe('Checking…');
    expect(screen.getByTestId('punch-screen-chip-location').getAttribute('aria-label')).toBe(
      'Location: Checking…',
    );
    // Read-only: no chip is a button.
    expect(screen.getByTestId('punch-screen-chip-location').tagName).toBe('DIV');
    expect(screen.getByTestId('punch-screen-chip-biometric').tagName).toBe('DIV');
    // Their sources: the pairing store and the signer; the client was asked for /me only.
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.capability).toHaveBeenCalledTimes(1);
    expect(h.getMe).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.deps.client)).toEqual(['getMe']);
  });

  it('"Not set up" when the strong biometric is not enrolled; "Location off" without a location check', async () => {
    const h = harness(
      [{ ...ME, location: { locationCheck: false } }],
      [],
      'NO_STRONG_BIOMETRIC_ENROLLED',
    );
    renderPunch(h);
    await screen.findByRole('button', { name: CHECK_IN });
    await waitFor(() =>
      expect(screen.getByTestId('punch-screen-chip-biometric').textContent).toBe('Not set up'),
    );
    expect(screen.getByTestId('punch-screen-chip-location').textContent).toBe('Location off');
  });

  it('under reduce motion: HH:mm clock, a minute interval, no ring on a stored punch (R12.7)', async () => {
    phone.reduceMotion = true;
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const h = harness(
      [ME, { ...ME, nextDirection: 'OUT', todayIn: '09:12' }],
      [stored(['Checked in at 09:12'])],
    );
    renderPunch(h);
    await screen.findByRole('button', { name: CHECK_IN });
    await waitFor(() => expect(screen.getByTestId('punch-screen-clock').textContent).toBe('09:12'));
    // The clock's intervals (testing-library polls with its own, shorter one): the last is a minute.
    const intervals = setInterval.mock.calls
      .map((call) => call[1])
      .filter((ms) => ms === 1000 || ms === 60_000);
    expect(intervals[intervals.length - 1]).toBe(60_000);
    expect(screen.queryByTestId('punch-button-ring')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: CHECK_IN }));
    await waitFor(() => expect(outcomeCard().textContent).toContain('Checked in at 09:12'));
    expect(screen.queryByTestId('punch-button-ring')).toBeNull();
    // The haptic is not motion: it still plays once.
    expect(haptics.punchStored).toHaveBeenCalledTimes(1);
    setInterval.mockRestore();
  });

  it('at 200 % font the circle keeps its size and only the label shrinks (R12.2)', async () => {
    phone.fontScale = 2;
    const h = harness([ME]);
    renderPunch(h);
    const button = await screen.findByRole('button', { name: CHECK_IN });
    expect(styleOf(button)).toMatchObject({ width: 200, height: 200 });
    const label = screen.getByTestId('punch-button-label');
    expect(adjustsFontSizeToFitOf(label)).toBe(true);
    // No other text on the screen shrinks or truncates (R12.11).
    expect(document.querySelectorAll('[data-adjusts-font-size-to-fit]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-number-of-lines]')).toHaveLength(0);
  });

  it('every text on the screen is from the strings file or an HR-module text; none is empty', async () => {
    const h = harness([{ ...ME, nextDirection: 'OUT', todayIn: '09:12' }]);
    renderPunch(h);
    await screen.findByRole('button', { name: CHECK_OUT });
    const texts = Array.from(document.querySelectorAll('span'))
      .filter((span) => span.querySelector('span') === null)
      .map((span) => span.textContent ?? '');
    expect(texts.filter((text) => text.trim() === '')).toEqual([]);
    expect(texts).toContain(t('punch.todayTitle'));
    expect(texts).toContain(t('punch.checkOut'));
  });
});

describe('PunchScreen offline (R6.1–R6.4, R6.13, R6.14, R6.16)', () => {
  it('when /me is not reachable: the OFFLINE_NOTICE warning card and the button still offers Check in (R6.2)', async () => {
    const h = harness([new NotReachable('TIMEOUT')]);
    renderPunch(h);
    await waitFor(() => expect(outcomeCard().textContent).toContain(OFFLINE_NOTICE));
    expect(tokenNameOf(TOKENS.light, styleOf(outcomeCard()).backgroundColor)).toContain(
      'warningSoft',
    );
    expect(screen.getByRole('button', { name: CHECK_IN })).toBeTruthy();
    expect(screen.getByTestId('punch-screen-date').textContent).toBe('Thu, 3 Apr 2025');
    expect(h.onUnpaired).not.toHaveBeenCalled();
  });

  it('the offline notice clears once /me answers again', async () => {
    const h = harness([new NotReachable('TIMEOUT'), ME]);
    renderPunch(h);
    await waitFor(() => expect(outcomeCard().textContent).toContain(OFFLINE_NOTICE));
    refocus();
    await waitFor(() => expect(screen.queryByTestId('punch-screen-outcome')).toBeNull());
  });

  it('a queued punch: the SAVED_OFFLINE success card, punchStored once, no second /me read (R6.3)', async () => {
    const h = harness(
      [ME],
      [{ kind: 'queued', message: SAVED_OFFLINE, punch: queued(), signedOnline: false }],
    );
    renderPunch(h);
    fireEvent.click(await screen.findByRole('button', { name: CHECK_IN }));
    await waitFor(() => expect(outcomeCard().textContent).toContain(SAVED_OFFLINE));
    expect(tokenNameOf(TOKENS.light, styleOf(outcomeCard()).backgroundColor)).toContain(
      'successSoft',
    );
    expect(h.getMe).toHaveBeenCalledTimes(1);
    expect(h.run).toHaveBeenCalledWith({ directionGuess: 'IN' });
    expect(haptics.punchStored).toHaveBeenCalledTimes(1);
  });

  it('while punches wait, the direction comes from the newest queued punch and the status line is the waiting count (R6.4, R6.16)', async () => {
    const h = harness([ME]);
    renderPunch(h);
    await screen.findByRole('button', { name: CHECK_IN });

    act(() => h.sync.publish({ waiting: 1, refused: [], newestDirection: 'IN' }));
    expect(await screen.findByRole('button', { name: CHECK_OUT })).toBeTruthy();
    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe(
      '1 punch waiting to be sent',
    );

    act(() => h.sync.publish({ waiting: 2, refused: [], newestDirection: 'OUT' }));
    expect(await screen.findByRole('button', { name: CHECK_IN })).toBeTruthy();
    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe(
      '2 punches waiting to be sent',
    );

    act(() => h.sync.publish({ waiting: 0, refused: [], newestDirection: null }));
    expect(await screen.findByRole('button', { name: CHECK_IN })).toBeTruthy();
    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe('Not checked in yet');
  });

  it('the tap passes the queue-derived direction as the guess', async () => {
    const h = harness(
      [ME],
      [{ kind: 'queued', message: SAVED_OFFLINE, punch: queued(), signedOnline: false }],
    );
    renderPunch(h);
    await screen.findByRole('button', { name: CHECK_IN });
    act(() => h.sync.publish({ waiting: 1, refused: [], newestDirection: 'IN' }));
    fireEvent.click(await screen.findByRole('button', { name: CHECK_OUT }));
    await waitFor(() => expect(h.run).toHaveBeenCalledWith({ directionGuess: 'OUT' }));
  });

  it('a refused waiting punch is a danger card with date, time, direction and the message; OK dismisses it (R6.13, R6.14)', async () => {
    const h = harness([ME]);
    const refused = queued({
      punchId: 'a1b2c3d4-0000-4000-8000-000000000009',
      phoneTime: '2025-04-02T12:35:00Z', // 18:05 IST on 2 Apr
      directionGuess: 'OUT',
      state: 'REFUSED',
      refusalMessage: 'Too late to send this check-in. Ask your manager to mark your attendance.',
    });
    renderPunch(h);
    await screen.findByRole('button', { name: CHECK_IN });
    act(() => h.sync.publish({ waiting: 0, refused: [refused], newestDirection: null }));

    const card = await screen.findByTestId(`refused-${refused.punchId}`);
    expect(card.textContent).toContain('Wed, 2 Apr 2025 · 18:05 · Check out');
    expect(card.textContent).toContain(
      'Too late to send this check-in. Ask your manager to mark your attendance.',
    );
    expect(tokenNameOf(TOKENS.light, styleOf(card).backgroundColor)).toContain('dangerSoft');
    // A refused punch is not "waiting to be sent".
    expect(screen.getByTestId('punch-screen-status-line').textContent).toBe('Not checked in yet');

    fireEvent.click(within(card).getByRole('button', { name: REFUSAL_OK }));
    await waitFor(() => expect(h.sync.dismissed).toEqual([refused.punchId]));
    await waitFor(() => expect(screen.queryByTestId(`refused-${refused.punchId}`)).toBeNull());
    expectNoHaptics();
  });
});
