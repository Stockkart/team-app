// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { duration, easing, motionDuration, useMotionDuration, useReducedMotion } from './motion';

/** A controllable "reduce motion" setting behind the `react-native` test alias. */
const phone = vi.hoisted(() => ({
  reduced: false,
  listeners: new Set<(value: boolean) => void>(),
  reset() {
    this.reduced = false;
    this.listeners.clear();
  },
  flip(value: boolean) {
    this.reduced = value;
    for (const listener of this.listeners) {
      listener(value);
    }
  },
}));

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      isReduceMotionEnabled: () => Promise.resolve(phone.reduced),
      addEventListener: (_event: string, handler: (value: boolean) => void) => {
        phone.listeners.add(handler);
        return { remove: () => phone.listeners.delete(handler) };
      },
    },
  };
});

afterEach(() => {
  cleanup();
  phone.reset();
});

/** Lets the hook's first `isReduceMotionEnabled()` read land. */
const settle = () => act(async () => Promise.resolve());

describe('motion durations (R12.7)', () => {
  it('animates in 200 ms and never longer than 300 ms', () => {
    expect(duration.standard).toBe(200);
    expect(duration.max).toBe(300);
    expect(duration.standard).toBeLessThanOrEqual(duration.max);
  });

  it('motionDuration passes the standard duration through', () => {
    expect(motionDuration(duration.standard, false)).toBe(200);
    expect(motionDuration(120, false)).toBe(120);
  });

  it('motionDuration caps a longer request at the maximum', () => {
    expect(motionDuration(1000, false)).toBe(duration.max);
    expect(motionDuration(301, false)).toBe(300);
  });

  it('motionDuration is 0 for every request when motion is reduced', () => {
    expect(motionDuration(duration.standard, true)).toBe(0);
    expect(motionDuration(duration.max, true)).toBe(0);
    expect(motionDuration(5, true)).toBe(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'motionDuration treats a request of %s as 0',
    (requested) => {
      expect(motionDuration(requested, false)).toBe(0);
    },
  );
});

describe('easing', () => {
  it('is a standard ease-out: starts fast, lands softly, pinned at 0 and 1', () => {
    expect(easing(0)).toBe(0);
    expect(easing(1)).toBe(1);
    // Ease-out: more than half the distance is covered in the first half of the time.
    expect(easing(0.5)).toBeGreaterThan(0.5);
    // Monotonic.
    let previous = 0;
    for (let t = 0.1; t <= 1; t += 0.1) {
      const value = easing(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('useReducedMotion (R12.7)', () => {
  it('answers false until the phone setting is read, then the setting', async () => {
    phone.reduced = true;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    await settle();
    expect(result.current).toBe(true);
  });

  it('follows the setting when it changes while the app is open', async () => {
    const { result } = renderHook(() => useReducedMotion());
    await settle();
    expect(result.current).toBe(false);
    act(() => phone.flip(true));
    expect(result.current).toBe(true);
    act(() => phone.flip(false));
    expect(result.current).toBe(false);
  });

  it('stops listening when unmounted', async () => {
    const { unmount } = renderHook(() => useReducedMotion());
    await settle();
    expect(phone.listeners.size).toBe(1);
    unmount();
    expect(phone.listeners.size).toBe(0);
  });
});

describe('useMotionDuration (R12.7)', () => {
  it('is the standard 200 ms by default and never above 300 ms', async () => {
    const standard = renderHook(() => useMotionDuration());
    const long = renderHook(() => useMotionDuration(1000));
    await settle();
    expect(standard.result.current).toBe(duration.standard);
    expect(long.result.current).toBe(duration.max);
  });

  it('becomes 0 for every request once the phone reduces motion', async () => {
    const standard = renderHook(() => useMotionDuration());
    const long = renderHook(() => useMotionDuration(1000));
    await settle();
    act(() => phone.flip(true));
    expect(standard.result.current).toBe(0);
    expect(long.result.current).toBe(0);
  });
});
