/**
 * usePolling - run a callback now and then every `intervalMs`, but only while
 * the tab is visible.
 *
 *   usePolling(loadRealtime, 30_000, enabled);
 *   usePolling(loadSummary, 300_000, enabled, days); // restarts when `days` changes
 *
 * - Pauses while `document.hidden` (no background traffic for hidden tabs).
 * - When the tab becomes visible again it refreshes immediately if the last
 *   run is older than one interval; otherwise the next run happens when it
 *   was due anyway (not a whole new interval later). Then the normal cadence
 *   resumes.
 * - The latest callback is always used (no restart when its identity changes);
 *   pass `resetKey` to force an immediate run + fresh interval.
 * - Everything is cleaned up on unmount / when disabled.
 */

import { useEffect, useRef } from 'react';

export function usePolling(
  callback: () => void,
  intervalMs: number,
  enabled: boolean = true,
  resetKey?: unknown
): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let timer: number | undefined; // the regular interval
    let pending: number | undefined; // one-shot wait until the next run is due
    let lastRun = 0;

    const run = () => {
      lastRun = Date.now();
      callbackRef.current();
    };
    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
      if (pending !== undefined) {
        window.clearTimeout(pending);
        pending = undefined;
      }
    };
    const runAndStart = () => {
      stop();
      run();
      timer = window.setInterval(run, intervalMs);
    };
    const onVisibilityChange = () => {
      stop();
      if (document.hidden) return;
      const wait = intervalMs - (Date.now() - lastRun);
      if (wait <= 0) {
        runAndStart();
      } else {
        pending = window.setTimeout(runAndStart, wait);
      }
    };

    if (!document.hidden) runAndStart();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs, resetKey]);
}
