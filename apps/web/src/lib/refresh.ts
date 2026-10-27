import { useEffect, useRef } from 'react';

// Re-runs a loader when the app comes back to the foreground and periodically while visible,
// so changes made elsewhere (a parent reassigning a chore, a new day starting) show up without a reload.
export function useAutoRefresh(load: () => unknown, intervalMs = 60_000) {
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') loadRef.current();
    };
    const timer = window.setInterval(refresh, intervalMs);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [intervalMs]);
}
