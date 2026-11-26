import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KEY_INVALIDATED } from '@stockkart/attendance-protocol';

import { renderThemed } from '../../test-support/render';
import type { AppDeps } from '../app/deps';
import type { PairingEnded } from '../app/pairingEnded';
import type { ShellActions } from '../app/useAppState';
import type { PairingRecord } from '../state/pairingStore';
import { AttendanceModule } from './AttendanceModule';
import type { PunchScreenProps } from './PunchScreen';

// jsdom with `react-native` aliased to DOM elements (vite.config.mts). The focus hook is an effect
// that runs once on mount, which is what a focused screen does; `refocus()` runs it again the way
// the navigator does when the worker comes back from the pairing screens.
const focus = vi.hoisted(() => ({ effect: null as (() => void | (() => void)) | null }));
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    focus.effect = effect;
    useEffect(() => effect(), [effect]);
  },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// Both states draw the check-in screen (`PunchScreen`, DD17), which has its own tests; here a
// marker that records `enabled` and the deps it was fed, and exposes the seams the module listens
// on (the code button, the unpair and the signer error).
const mounted = vi.hoisted(() => ({ deps: [] as unknown[] }));
vi.mock('./PunchScreen', () => ({
  PunchScreen: ({ deps, enabled, onHaveCode, onUnpaired, onSignerError }: PunchScreenProps) => {
    mounted.deps.push(deps);
    return (
      <div data-testid="punch-screen" data-enabled={String(enabled)}>
        {enabled ? null : <button data-testid="attendance-code" onClick={onHaveCode} />}
        <button data-testid="punch-screen-unpaired" onClick={onUnpaired} />
        <button
          data-testid="punch-screen-key-invalidated"
          onClick={() => onSignerError?.('KEY_INVALIDATED', KEY_INVALIDATED)}
        />
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  mounted.deps.length = 0;
});

const PAIRING: PairingRecord = {
  pairingId: '66f1a2b3c4d5e6f708192a3b',
  shopId: 's1',
  employeeId: 'e1',
  employeeName: 'Priya Sharma',
  shopName: 'Sri Ganesh Stores',
  location: { locationCheck: false },
  consentVersion: 1,
};

const ACTIVE = {
  state: 'ACTIVE' as const,
  shop: { shopId: 's1', shopName: 'Sri Ganesh Stores' },
  modules: ['ATTENDANCE', 'HISTORY', 'PROFILE'],
  pairing: { state: 'NOT_PAIRED' as const },
};

function harness(record: PairingRecord | null) {
  let stored = record;
  const listeners = new Set<(ended: PairingEnded) => void>();
  const pairingStore = {
    load: vi.fn(async () => stored),
    wipe: vi.fn(async () => {
      stored = null;
    }),
  };
  // The account layer is present so a module that touched the session would be caught (R7.8).
  const authStore = {
    clearForLogout: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined),
  };
  const account = { logout: vi.fn(async () => ({ success: true })) };
  const deps = {
    pairingStore,
    authStore,
    account,
    client: {},
    punchFlow: {},
    sync: {},
    signer: {},
    onPairingEnded: vi.fn((listener: (ended: PairingEnded) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as unknown as AppDeps;
  const shell: ShellActions = {
    refresh: vi.fn(async () => undefined),
    apply: vi.fn(async () => undefined),
    handleError: vi.fn(() => false),
    confirm: vi.fn(async () => true),
  };
  return {
    deps,
    shell,
    pairingStore,
    authStore,
    account,
    pairingEnded(ended: PairingEnded) {
      stored = null;
      for (const listener of listeners) {
        listener(ended);
      }
    },
    pair() {
      stored = PAIRING;
    },
  };
}

function renderModule(h: ReturnType<typeof harness>) {
  const onHaveCode = vi.fn();
  const onBack = vi.fn();
  const view = renderThemed(
    <AttendanceModule
      deps={h.deps}
      shell={h.shell}
      state={ACTIVE}
      onHaveCode={onHaveCode}
      onBack={onBack}
    />,
  );
  return { ...view, onHaveCode, onBack };
}

describe('AttendanceModule (R7.1, R7.2, R7.8)', () => {
  it('Not enabled: the check-in screen with enabled = false; I have a code opens the pairing flow', async () => {
    const h = harness(null);
    const { onHaveCode, onBack } = renderModule(h);
    const punch = await screen.findByTestId('punch-screen');
    expect(punch.getAttribute('data-enabled')).toBe('false');
    expect(screen.getByTestId('attendance-not-enabled-state')).toBeTruthy();
    expect(screen.queryByTestId('attendance-enabled')).toBeNull();
    expect(screen.queryByTestId('attendance-ended')).toBeNull();

    fireEvent.click(screen.getByTestId('attendance-code'));
    expect(onHaveCode).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('attendance-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Enabled: a pairing on this phone shows the check-in screen with enabled = true over the HR-module deps and the signer', async () => {
    const h = harness(PAIRING);
    renderModule(h);
    expect(await screen.findByTestId('attendance-enabled')).toBeTruthy();
    expect(screen.getByTestId('punch-screen').getAttribute('data-enabled')).toBe('true');
    expect(screen.queryByTestId('attendance-code')).toBeNull();
    expect(screen.queryByTestId('screen-attendance-footer')).toBeNull();
    // The same deps object the navigator passes (R7.6): client, store, flow, sync, signer.
    expect(mounted.deps.at(-1)).toEqual({
      client: h.deps.client,
      pairingStore: h.deps.pairingStore,
      punchFlow: h.deps.punchFlow,
      sync: h.deps.sync,
      signer: h.deps.signer,
    });
  });

  it('decides from the phone\u2019s record, not the server\u2019s pairing state', async () => {
    // The server knows a pairing (another phone's); this phone has none.
    const h = harness(null);
    renderThemed(
      <AttendanceModule
        deps={h.deps}
        shell={h.shell}
        state={{ ...ACTIVE, pairing: { state: 'PAIRED', pairingId: PAIRING.pairingId } }}
        onHaveCode={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(await screen.findByTestId('attendance-code')).toBeTruthy();
  });

  it('becomes Enabled on the next focus once the pairing was stored (back from Consent, R7.1)', async () => {
    const h = harness(null);
    renderModule(h);
    await screen.findByTestId('attendance-code');
    h.pair();
    await act(async () => {
      focus.effect?.();
    });
    expect(await screen.findByTestId('attendance-enabled')).toBeTruthy();
    expect(screen.queryByTestId('attendance-code')).toBeNull();
  });

  it('pairing ended from the punch screen: back to Not enabled, session kept, state re-read (R7.8)', async () => {
    const h = harness(PAIRING);
    renderModule(h);
    await screen.findByTestId('attendance-enabled');
    fireEvent.click(screen.getByTestId('punch-screen-unpaired'));
    expect(await screen.findByTestId('attendance-code')).toBeTruthy();
    expect(h.shell.refresh).toHaveBeenCalledTimes(1);
    // The module never touches the session: no log out, no session clear, no server logout.
    expect(screen.queryByTestId('attendance-ended')).toBeNull();
    expect(h.authStore.clearForLogout).not.toHaveBeenCalled();
    expect(h.authStore.clearSession).not.toHaveBeenCalled();
    expect(h.account.logout).not.toHaveBeenCalled();
  });

  it('an invalidated key wipes the pairing and shows why above the card', async () => {
    const h = harness(PAIRING);
    renderModule(h);
    await screen.findByTestId('attendance-enabled');
    fireEvent.click(screen.getByTestId('punch-screen-key-invalidated'));
    expect((await screen.findByTestId('attendance-ended')).textContent).toContain(KEY_INVALIDATED);
    expect(h.pairingStore.wipe).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('attendance-code')).toBeTruthy();
    await waitFor(() => expect(h.shell.refresh).toHaveBeenCalledTimes(1));
  });

  it('the sync worker reporting the pairing over has the same effect (R3.3)', async () => {
    const h = harness(PAIRING);
    renderModule(h);
    await screen.findByTestId('attendance-enabled');
    act(() => {
      h.pairingEnded({ reason: 'NOT_PAIRED', message: 'This phone is no longer paired.' });
    });
    expect((await screen.findByTestId('attendance-ended')).textContent).toBe(
      'This phone is no longer paired.',
    );
    expect(screen.getByTestId('attendance-code')).toBeTruthy();
    expect(h.shell.refresh).toHaveBeenCalledTimes(1);
    // The pairing is gone but the worker stays signed in (R7.8).
    expect(h.authStore.clearForLogout).not.toHaveBeenCalled();
    expect(h.authStore.clearSession).not.toHaveBeenCalled();
    expect(h.account.logout).not.toHaveBeenCalled();
  });
});
