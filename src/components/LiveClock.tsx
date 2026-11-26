/**
 * The live clock of the check-in screen (design "Check-in screen", R7.11, R12.2, R12.7): the time
 * in Asia/Kolkata as `display` text in `textPrimary`, `HH:mm:ss` updated every second, or `HH:mm`
 * updated once a minute when the phone's "reduce motion" setting is on (`clockText`). One
 * `setInterval` runs while `active`; the screen passes its focus state so the timer is cleared on
 * blur and nothing ticks behind another screen. TalkBack reads the time once when focused: the
 * text is not a live region, so the ticking is never announced.
 */
import { useEffect, useState } from 'react';

import { clockText } from '../punch/punchScreen';
import { useReducedMotion } from '../theme';
import { AppText } from './AppText';

export interface LiveClockProps {
  /** The screen is focused: the clock ticks. Off, the last text stays and the timer is cleared. */
  active?: boolean;
  /** Phone clock in epoch milliseconds; `Date.now` on the phone. */
  now?: () => number;
  testID?: string;
}

/** Tick intervals (ms): every second, or every minute under reduce motion (R7.11). */
export const CLOCK_TICK_MS = 1000;
export const CLOCK_TICK_REDUCED_MS = 60_000;

/** The interval the clock runs on for the phone's motion setting. */
export function clockIntervalMs(reduceMotion: boolean): number {
  return reduceMotion ? CLOCK_TICK_REDUCED_MS : CLOCK_TICK_MS;
}

export function LiveClock({ active = true, now = Date.now, testID }: LiveClockProps) {
  const reduceMotion = useReducedMotion();
  const [nowMs, setNowMs] = useState(now);

  useEffect(() => {
    if (!active) {
      return;
    }
    setNowMs(now());
    const timer = setInterval(() => setNowMs(now()), clockIntervalMs(reduceMotion));
    return () => clearInterval(timer);
  }, [active, now, reduceMotion]);

  return (
    <AppText variant="display" color="textPrimary" align="center" testID={testID}>
      {clockText(nowMs, reduceMotion)}
    </AppText>
  );
}
