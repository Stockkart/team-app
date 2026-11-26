import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { styleOf } from '../../test-support/react-native-dom';
import { SCHEMES, renderThemed } from '../../test-support/render';
import { tokenNameOf } from '../../test-support/tokens';
import { TOKENS, typeScale } from '../theme';
import { CLOCK_TICK_MS, CLOCK_TICK_REDUCED_MS, LiveClock, clockIntervalMs } from './LiveClock';

const phone = vi.hoisted(() => ({ reduceMotion: false }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../test-support/react-native-dom')>();
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      isReduceMotionEnabled: () => Promise.resolve(phone.reduceMotion),
    },
  };
});

/** 2025-04-03 09:12:07 IST. */
const START = Date.UTC(2025, 3, 3, 3, 42, 7);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  phone.reduceMotion = false;
});

/** Lets the reduce-motion read answer (a resolved promise) under fake timers. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('LiveClock (R7.11, R12.2, R12.7)', () => {
  it('clockIntervalMs: every second, every minute under reduce motion', () => {
    expect(clockIntervalMs(false)).toBe(CLOCK_TICK_MS);
    expect(clockIntervalMs(true)).toBe(CLOCK_TICK_REDUCED_MS);
    expect(CLOCK_TICK_MS).toBe(1000);
    expect(CLOCK_TICK_REDUCED_MS).toBe(60_000);
  });

  it.each(SCHEMES)(
    'in %s: display text in textPrimary, HH:mm:ss in Asia/Kolkata, ticking every second',
    async (scheme) => {
      const tokens = TOKENS[scheme];
      renderThemed(<LiveClock now={Date.now} testID="clock" />, scheme);
      await settle();
      const clock = screen.getByTestId('clock');
      expect(clock.textContent).toBe('09:12:07');
      expect(styleOf(clock).fontSize).toBe(typeScale.display.fontSize);
      expect(styleOf(clock).fontSize).toBeGreaterThanOrEqual(40);
      expect(tokenNameOf(tokens, styleOf(clock).color)).toContain('textPrimary');
      expect(clock.getAttribute('aria-live')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(clock.textContent).toBe('09:12:08');
      act(() => {
        vi.advanceTimersByTime(52_000);
      });
      expect(clock.textContent).toBe('09:13:00');
    },
  );

  it('under reduce motion shows HH:mm and ticks once a minute', async () => {
    phone.reduceMotion = true;
    renderThemed(<LiveClock now={Date.now} testID="clock" />);
    await settle();
    const clock = screen.getByTestId('clock');
    expect(clock.textContent).toBe('09:12');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // No change within the minute, even though the clock has moved to 09:12:08.
    expect(clock.textContent).toBe('09:12');
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(clock.textContent).toBe('09:13');
  });

  it('runs one interval while active and clears it on blur', async () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const clearInterval = vi.spyOn(globalThis, 'clearInterval');
    const { rerender } = renderThemed(<LiveClock active now={Date.now} testID="clock" />);
    await settle();
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(setInterval.mock.calls[0][1]).toBe(CLOCK_TICK_MS);
    const before = clearInterval.mock.calls.length;

    rerender(<LiveClock active={false} now={Date.now} testID="clock" />);
    expect(clearInterval.mock.calls.length).toBe(before + 1);
    const text = screen.getByTestId('clock').textContent;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Blurred: the text stays where it was and no new interval starts.
    expect(screen.getByTestId('clock').textContent).toBe(text);
    expect(setInterval).toHaveBeenCalledTimes(1);

    // Focused again: a fresh interval and a fresh read of the clock.
    rerender(<LiveClock active now={Date.now} testID="clock" />);
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('clock').textContent).toBe('09:12:12');
  });
});
