/**
 * Calls `tick` every `intervalMs` while the component is mounted (the Waiting screen's 60-second
 * re-read of the request status, R3.10, R10.4). The timer is one `setInterval`, cleared on unmount
 * or when the interval changes; `tick` is read through a ref, so the latest closure runs without
 * restarting the timer. Overlap is not this hook's concern: the Waiting screen's tick is
 * `shell.refresh()`, which joins a read already in flight (`useAppState`), so two ticks can never
 * make two reads (design Property 31).
 *
 * React only; no React Native import.
 */
import { useEffect, useRef } from 'react';

/** The Waiting screen's poll interval (R3.10: "at least every 60 seconds"). */
export const WAITING_POLL_MS = 60_000;

export function usePolling(intervalMs: number, tick: () => void, enabled = true): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      tickRef.current();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
}
