'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { t } from './i18n';
import { nativePlugins, nativePost } from './native';
import { useSession } from './session';

export type SharingStatus = 'off' | 'on' | 'denied' | 'unsupported';

export type FamilyLocation = { userId: string; lat: number; lng: number; accuracy: number | null; updatedAt: string };

// A moving phone reports at most this often...
const MIN_REPORT_MS = 10_000;
// ...and a still one keeps reporting at this pace, so the family can see it's live.
const HEARTBEAT_MS = 30_000;
// A fix this old (the app was suspended) isn't where the person is now.
const MAX_FIX_AGE_MS = 120_000;
// The Android app only hears about a phone that moved at least this far.
const NATIVE_DISTANCE_FILTER_M = 20;

type LocationValue = {
  status: SharingStatus;
  start: () => void;
  stop: () => Promise<void>;
};

const LocationContext = createContext<LocationValue | null>(null);

type Fix = { lat: number; lng: number; accuracy: number | null; time: number };

// Reports this device's position while the app is open. Browsers stop geolocation once the app
// is in the background, so this can't run while Chorly is closed there; the Android app keeps
// going through a native watcher. The switch is per device: a laptop left open shouldn't move
// someone away from the phone in their pocket.
export function LocationProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const flagKey = `chorly.shareLocation.${me.id}`;
  const [status, setStatus] = useState<SharingStatus>('off');
  const reporting = useRef(false);
  const lastReport = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!('geolocation' in navigator)) setStatus('unsupported');
    else setStatus(localStorage.getItem(flagKey) ? 'on' : 'off');
  }, [flagKey]);

  const start = useCallback(() => {
    localStorage.setItem(flagKey, '1');
    setStatus('on');
  }, [flagKey]);

  const halt = useCallback(
    async (next: SharingStatus) => {
      reporting.current = false;
      localStorage.removeItem(flagKey);
      setStatus(next);
      // After any report still on its way, or that report would put the location back.
      await lastReport.current.catch(() => undefined);
      await api.delete('/location/me');
    },
    [flagKey],
  );

  const stop = useCallback(() => halt('off'), [halt]);

  useEffect(() => {
    if (status !== 'on') return;
    reporting.current = true;
    const native = nativePlugins();
    let fix: Fix | null = null;
    let reportedAt = 0;

    const report = (minGapMs: number) => {
      if (!fix || !reporting.current) return;
      // The native watcher stays quiet while the phone is still, so its last fix doesn't go stale.
      if (Date.now() - reportedAt < minGapMs || (!native && Date.now() - fix.time > MAX_FIX_AGE_MS)) return;
      reportedAt = Date.now();
      const { lat, lng, accuracy } = fix;
      const send = native ? nativePost : api.post;
      lastReport.current = send('/location/me', { lat, lng, accuracy }).catch(() => undefined);
    };

    const timer = window.setInterval(() => report(HEARTBEAT_MS), HEARTBEAT_MS);

    if (native) {
      let stopped = false;
      // Android 13+ hides the "sharing your location" notification without this permission.
      const watcher = Promise.resolve(native.PushNotifications.requestPermissions())
        .catch(() => undefined)
        .then(() => {
          if (stopped) return null;
          return native.BackgroundGeolocation.addWatcher(
            {
              backgroundTitle: t('locator.backgroundTitle'),
              backgroundMessage: t('locator.backgroundMessage'),
              requestPermissions: true,
              stale: false,
              distanceFilter: NATIVE_DISTANCE_FILTER_M,
            },
            (location: any, error: any) => {
              if (error) {
                if (error.code === 'NOT_AUTHORIZED') halt('denied').catch(() => undefined);
                return;
              }
              if (!location) return;
              fix = { lat: location.latitude, lng: location.longitude, accuracy: location.accuracy, time: location.time };
              report(MIN_REPORT_MS);
            },
          );
        });
      return () => {
        stopped = true;
        window.clearInterval(timer);
        watcher.then((id) => id && native.BackgroundGeolocation.removeWatcher({ id })).catch(() => undefined);
      };
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        fix = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, time: timestamp };
        report(MIN_REPORT_MS);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) halt('denied').catch(() => undefined);
      },
      { enableHighAccuracy: true, maximumAge: MIN_REPORT_MS },
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
    };
  }, [status, halt]);

  const value = useMemo(() => ({ status, start, stop }), [status, start, stop]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocationSharing() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocationSharing must be used inside LocationProvider');
  return ctx;
}
