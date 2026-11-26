/**
 * Motion rules (R12.7): screen transitions and state changes take 200 ms with a standard ease,
 * nothing takes longer than 300 ms, and when the phone's "reduce motion" setting is on every
 * animation becomes an instant change.
 *
 * `motionDuration` is the pure rule; `useReducedMotion` reads the phone's setting and follows it
 * live; `useMotionDuration` combines the two for components.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';

export const duration = {
  /** Every transition and state change. */
  standard: 200,
  /** No animation may take longer. */
  max: 300,
} as const;

/** The one easing curve: fast start, soft landing. */
export const easing = Easing.out(Easing.cubic);

/**
 * The duration to animate with: `0` when motion is reduced, else `requested` capped at
 * `duration.max`. A negative or non-finite request is treated as `0`.
 */
export function motionDuration(requested: number, reducedMotion: boolean): number {
  if (reducedMotion || !Number.isFinite(requested) || requested <= 0) {
    return 0;
  }
  return Math.min(requested, duration.max);
}

/**
 * The phone's "reduce motion" setting, `false` until the first read answers. Subscribes to the
 * change event so a setting flipped while the app is open takes effect without a restart.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) {
          setReduced(value);
        }
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

/** `motionDuration(requested, useReducedMotion())` for components. */
export function useMotionDuration(requested: number = duration.standard): number {
  return motionDuration(requested, useReducedMotion());
}
