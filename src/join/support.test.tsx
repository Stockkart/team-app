import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TOO_MANY_ATTEMPTS_WORKER } from '@stockkart/attendance-protocol';

import { inferAccountErrorCode } from '../api/accountClient';
import { NotReachable, ServerRefusal } from '../api/transport';
import { STRINGS_EN } from '../i18n';
import { logOut } from './logOut';
import { errorText, requestedOnLine } from './screenSupport';
import { usePolling } from './usePolling';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('logOut (R9.5)', () => {
  it('ends the session on the server, clears the account set, then re-reads: in that order', async () => {
    const calls: string[] = [];
    const deps = {
      account: {
        logout: vi.fn(async () => {
          calls.push('server');
          return { success: true };
        }),
      },
      authStore: {
        clearForLogout: vi.fn(async () => {
          calls.push('clear');
        }),
      },
    };
    const shell = {
      refresh: vi.fn(async () => {
        calls.push('refresh');
      }),
    };
    await logOut(deps, shell);
    expect(calls).toEqual(['server', 'clear', 'refresh']);
  });

  it('still clears and re-reads when the server is not reachable or a key cannot be deleted', async () => {
    const onError = vi.fn();
    const deps = {
      account: {
        logout: vi.fn(async () => {
          throw new NotReachable('CONNECTION');
        }),
      },
      authStore: {
        clearForLogout: vi.fn(async () => {
          throw new Error('secure store');
        }),
      },
    };
    const shell = { refresh: vi.fn(async () => undefined) };
    await expect(logOut(deps, shell, onError)).resolves.toBeUndefined();
    expect(deps.authStore.clearForLogout).toHaveBeenCalledTimes(1);
    expect(shell.refresh).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});

describe('usePolling (R3.10)', () => {
  it('ticks every interval with the latest callback and stops on unmount', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ tick }: { tick: () => void }) => usePolling(1_000, tick),
      { initialProps: { tick: first } },
    );

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(first).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(first).toHaveBeenCalledTimes(1);

    // A new callback is used without restarting the timer.
    rerender({ tick: second });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled or given a non-positive interval', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    renderHook(() => usePolling(1_000, tick, false));
    renderHook(() => usePolling(0, tick));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(tick).not.toHaveBeenCalled();
  });
});

describe('errorText', () => {
  it('not reachable → the common line; a refusal → its text word for word; else "something went wrong"', () => {
    expect(errorText(new NotReachable('TIMEOUT'))).toBe(STRINGS_EN['common.notReachable']);
    expect(errorText(new ServerRefusal(429, TOO_MANY_ATTEMPTS_WORKER, inferAccountErrorCode))).toBe(
      TOO_MANY_ATTEMPTS_WORKER,
    );
    expect(errorText(new Error('boom'))).toBe(STRINGS_EN['common.somethingWentWrong']);
  });
});

describe('requestedOnLine (R6.3)', () => {
  it('shows the request day in Asia/Kolkata', () => {
    // 20:30 UTC on 11 May is 02:00 on 12 May in Asia/Kolkata.
    expect(requestedOnLine('2025-05-11T20:30:00Z')).toBe('Requested on Mon, 12 May 2025');
    expect(requestedOnLine('2025-05-11T18:29:59Z')).toBe('Requested on Sun, 11 May 2025');
  });

  it('shows a value that is not an instant as it is', () => {
    expect(requestedOnLine('yesterday')).toBe('Requested on yesterday');
  });
});
