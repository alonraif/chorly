'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { t } from './i18n';
import { nativeLocation, nativePlugins, nativePost, type NativeLocationStatus } from './native';
import { useSession } from './session';
import { useUi } from '../components/ui';

export type SharingStatus = 'off' | 'on' | 'denied' | 'unsupported';

// A moving phone reports at most this often...
const MIN_REPORT_MS = 10_000;
// ...and a still one keeps reporting at this pace, so the family can see it's live.
const HEARTBEAT_MS = 30_000;
// The timer can fire a hair early; without this slack it would skip every other beat.
const TIMER_SLACK_MS = 1_000;
// A fix this old (the app was suspended) isn't where the person is now.
const MAX_FIX_AGE_MS = 120_000;
// App 1.1's background plugin only hears about a phone that moved at least this far.
const LEGACY_DISTANCE_FILTER_M = 20;

export type StartOptions = { mode: 'exact' | 'blurred'; durationMinutes: number | null; recap: boolean; trail: boolean };

/** A step that makes sharing from the Android app more reliable. */
export type NativeFix = 'precise' | 'background' | 'battery' | 'locationOn' | 'motion' | 'settings';

type LocationValue = {
  status: SharingStatus;
  /** Resolves with what the phone allows, in the Android app; null elsewhere. */
  start: (options: StartOptions) => Promise<NativeLocationStatus | null>;
  stop: () => Promise<void>;
  /** Sends the position now instead of at the next beat: the family shouldn't wait after a resume. */
  reportNow: () => void;
  /** What the phone allows, in the Android app 1.2 and later; null anywhere else. */
  native: NativeLocationStatus | null;
  fixNative: (step: NativeFix) => Promise<void>;
};

const LocationContext = createContext<LocationValue | null>(null);

type Fix = { lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null; time: number };

/** Whether the phone lets sharing carry on with the app closed, after a restart, and with the right position. */
export function nativeReady(status: NativeLocationStatus | null) {
  return !status || (status.background && status.precise && status.batteryUnrestricted && status.locationOn);
}

const heading = (value: number | null | undefined) => (value != null && Number.isFinite(value) && value >= 0 && value <= 360 ? value : null);

// Reports this device's position. In the Android app (1.2 and later) a native service does it by
// itself, with the app open or not; this only switches it on and off and keeps an eye on what the
// phone allows. Browsers stop geolocation once the app is in the background, so there it only runs
// while Chorly is open. The switch is per device: a laptop left open shouldn't move someone away
// from the phone in their pocket, and the server ranks the phone above a browser.
export function LocationProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { toast } = useUi();
  const flagKey = `chorly.shareLocation.${me.id}`;
  const [status, setStatus] = useState<SharingStatus>('off');
  const [native, setNative] = useState<NativeLocationStatus | null>(null);
  const reporting = useRef(false);
  const lastReport = useRef<Promise<unknown>>(Promise.resolve());
  const sendNow = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus(localStorage.getItem(flagKey) ? 'on' : 'off');
    // The service is what's really sharing; the page's flag can be lost with its storage.
    nativeLocation()
      ?.getStatus()
      .then((current: NativeLocationStatus) => {
        setNative(current);
        if (current.enabled) {
          localStorage.setItem(flagKey, '1');
          setStatus('on');
        }
      })
      .catch(() => undefined);
  }, [flagKey]);

  const refreshNative = useCallback(async () => {
    const plugin = nativeLocation();
    if (!plugin) return null;
    const current: NativeLocationStatus = await plugin.getStatus();
    setNative(current);
    return current;
  }, []);

  // The terms are saved before the first position goes out, so the family never sees more than was chosen.
  const start = useCallback(
    async (options: StartOptions) => {
      const plugin = nativeLocation();
      let allowed: NativeLocationStatus | null = null;
      if (plugin) {
        allowed = await plugin.requestForeground();
        setNative(allowed);
        if (!allowed!.foreground) {
          setStatus('denied');
          throw new Error(t('locator.denied'));
        }
        // Android 13+ hides the "sharing your location" notification without this permission.
        await Promise.resolve(nativePlugins()?.PushNotifications.requestPermissions()).catch(() => undefined);
      }
      await api.put('/location/me/settings', options);
      localStorage.setItem(flagKey, '1');
      setStatus('on');
      return allowed;
    },
    [flagKey],
  );

  const halt = useCallback(
    async (next: SharingStatus) => {
      reporting.current = false;
      localStorage.removeItem(flagKey);
      setStatus(next);
      // Resolves once the service has stopped and nothing it sent is still on its way.
      const plugin = nativeLocation();
      if (plugin) setNative(await plugin.stop().catch(() => null));
      // After any report still on its way, or that report would put the location back.
      await lastReport.current.catch(() => undefined);
      await api.delete('/location/me');
    },
    [flagKey],
  );

  const stop = useCallback(() => halt('off'), [halt]);

  const fixNative = useCallback(
    async (step: NativeFix) => {
      const plugin = nativeLocation();
      if (!plugin) return;
      if (step === 'precise') {
        const current: NativeLocationStatus = await plugin.requestForeground();
        // Once refused, the dialog doesn't come back: only Settings can change it.
        if (!current.precise) await plugin.openSettings();
      } else if (step === 'background') {
        await plugin.requestBackground().catch(() => plugin.openSettings());
      } else if (step === 'battery') {
        await plugin.requestBatteryExemption();
      } else if (step === 'motion') {
        const current: NativeLocationStatus = await plugin.requestMotion();
        if (!current.motion) await plugin.openSettings();
      } else if (step === 'locationOn') {
        await plugin.openLocationSettings();
      } else {
        await plugin.openSettings();
      }
      await refreshNative();
    },
    [refreshNative],
  );

  useEffect(() => {
    if (status !== 'on') return;
    reporting.current = true;
    const plugin = nativeLocation();

    // ---- Android app 1.2+: the native service shares by itself ----
    if (plugin) {
      let cancelled = false;
      const sync = async () => {
        const current = await refreshNative();
        if (cancelled || !current) return;
        if (current.stopReason) {
          await plugin.clearStopReason();
          // The page is signed in, so the login works again: carry on.
          if (current.stopReason === 'ended') toast(t('locator.sharingEnded'), 'info');
          if (current.stopReason !== 'signedOut') {
            await halt(current.stopReason === 'permission' ? 'denied' : 'off');
            return;
          }
        }
        if (!current.foreground) {
          await halt('denied');
          return;
        }
        // Starting again is harmless: it updates the notification's words and sends a fresh position.
        setNative(
          await plugin.start({
            url: `${window.location.origin}/api/location/me`,
            title: t('locator.backgroundTitle'),
            message: t('locator.backgroundMessage'),
          }),
        );
        // The family's places become geofences on the phone (app 1.3+), so arrivals are noticed at once.
        if (plugin.setPlaces) {
          const places: { id: string; lat: number; lng: number; radiusM: number }[] = await api.get('/location/places');
          await plugin.setPlaces({ places: places.map(({ id, lat, lng, radiusM }) => ({ id, lat, lng, radiusM })) }).catch(() => undefined);
        }
      };
      const run = () => sync().catch(() => undefined);
      run();
      sendNow.current = () => plugin.reportNow().catch(() => undefined);
      // Coming back from Settings, or to the app: see what changed, and show where this phone is now.
      const onVisible = () => {
        if (document.visibilityState === 'visible') run();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        cancelled = true;
        document.removeEventListener('visibilitychange', onVisible);
        sendNow.current = () => undefined;
      };
    }

    const legacy = nativePlugins()?.BackgroundGeolocation ?? null;
    let fix: Fix | null = null;
    let reportedAt = 0;

    const report = (minGapMs: number) => {
      if (!fix || !reporting.current) return;
      if (Date.now() - reportedAt < minGapMs || (!legacy && Date.now() - fix.time > MAX_FIX_AGE_MS)) return;
      reportedAt = Date.now();
      const { lat, lng, accuracy, speed } = fix;
      const send = legacy ? nativePost : api.post;
      lastReport.current = send('/location/me', {
        lat,
        lng,
        accuracy,
        speed,
        heading: fix.heading,
        // App 1.1 re-sends its last fix while the phone is still, so its age would only grow.
        ...(legacy ? {} : { ageMs: Math.max(0, Date.now() - fix.time) }),
        source: legacy ? 'native' : 'web',
        battery: battery ? Math.round(battery.level * 100) : null,
        charging: battery ? battery.charging : null,
      })
        // The timed share ran out: the server has forgotten the position and this device stops reporting.
        .then((result: any) => {
          if (result?.sharing === false) {
            toast(t('locator.sharingEnded'), 'info');
            halt('off').catch(() => undefined);
          }
        })
        .catch(() => undefined);
    };

    // Browsers go quiet while a phone lies still, so the page asks for a position itself.
    let freshen = () => undefined as void;
    const timer = window.setInterval(() => {
      if (legacy) report(HEARTBEAT_MS - TIMER_SLACK_MS);
      else if (fix && Date.now() - fix.time <= MIN_REPORT_MS) report(HEARTBEAT_MS - TIMER_SLACK_MS);
      // A browser's fix is dated, so re-sending an old one wouldn't tell the family anything: get a new one.
      else freshen();
    }, HEARTBEAT_MS);

    sendNow.current = () => {
      freshen();
      report(0);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') sendNow.current();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Not every browser has the Battery Status API (Safari doesn't); the family just sees no battery then.
    let battery: { level: number; charging: boolean } | null = null;
    (navigator as any).getBattery?.().then((b: any) => (battery = b)).catch(() => undefined);

    // ---- Android app 1.1: a background plugin, driven from here ----
    if (legacy) {
      let stopped = false;
      const watcher = Promise.resolve(nativePlugins()!.PushNotifications.requestPermissions())
        .catch(() => undefined)
        .then(() => {
          if (stopped) return null;
          return legacy.addWatcher(
            {
              backgroundTitle: t('locator.backgroundTitle'),
              backgroundMessage: t('locator.backgroundMessage'),
              requestPermissions: true,
              stale: false,
              distanceFilter: LEGACY_DISTANCE_FILTER_M,
            },
            (location: any, error: any) => {
              if (error) {
                if (error.code === 'NOT_AUTHORIZED') halt('denied').catch(() => undefined);
                return;
              }
              if (!location) return;
              fix = { lat: location.latitude, lng: location.longitude, accuracy: location.accuracy, speed: location.speed ?? null, heading: heading(location.bearing), time: location.time };
              report(MIN_REPORT_MS);
            },
          );
        });
      return () => {
        stopped = true;
        window.clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
        sendNow.current = () => undefined;
        watcher.then((id) => id && legacy.removeWatcher({ id })).catch(() => undefined);
      };
    }

    // ---- A browser ----
    const onPosition = ({ coords, timestamp }: GeolocationPosition) => {
      fix = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, speed: coords.speed, heading: heading(coords.heading), time: timestamp };
      report(MIN_REPORT_MS);
    };
    freshen = () => navigator.geolocation.getCurrentPosition(onPosition, () => undefined, { enableHighAccuracy: true, maximumAge: MIN_REPORT_MS, timeout: HEARTBEAT_MS });
    const watchId = navigator.geolocation.watchPosition(
      onPosition,
      (error) => {
        if (error.code === error.PERMISSION_DENIED) halt('denied').catch(() => undefined);
      },
      { enableHighAccuracy: true, maximumAge: MIN_REPORT_MS },
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      sendNow.current = () => undefined;
    };
  }, [status, halt, toast, refreshNative]);

  const reportNow = useCallback(() => sendNow.current(), []);
  const value = useMemo(() => ({ status, start, stop, reportNow, native, fixNative }), [status, start, stop, reportNow, native, fixNative]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocationSharing() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocationSharing must be used inside LocationProvider');
  return ctx;
}
