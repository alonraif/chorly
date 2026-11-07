'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { hueFor, initials } from '../../../components/avatar';
import { FamilyMap, type MapPerson } from '../../../components/family-map';
import { firstName, friendlyDay, relativeTime, timeOf, zoned } from '../../../lib/format';
import { t, tn } from '../../../lib/i18n';
import { isStale, pulseOf, type PersonLocation, type Place, type PlaceKind, type SharingMode } from '../../../lib/places';
import { useAutoRefresh } from '../../../lib/refresh';
import './share.css';

type SharedPerson = {
  id: string;
  displayName: string;
  avatarAt: string | null;
  location: {
    mode: SharingMode;
    updatedAt: string;
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    blurRadiusM: number | null;
    placeSince: string | null;
  } | null;
  place: { name: string; kind: PlaceKind } | null;
};
type SharedMap = { label: string | null; expiresAt: string; people: SharedPerson[] };
type Stage = 'loading' | 'gone' | 'locked' | 'choose' | 'confirm' | 'enter' | 'map';

const REFRESH_MS = 15_000;
const NONE: never[] = [];

// Not the app's api helper: there's no session here, and a refusal must never send the visitor to the sign-in page.
async function call(path: string, init: { method?: string; body?: unknown; view?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.view) headers['X-Share-View'] = init.view;
  const res = await fetch(`/api/share/location/${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// The helpers on the family's map work on full locations; a shared one has fewer fields.
function asLocation(person: SharedPerson): PersonLocation | null {
  const l = person.location;
  if (!l) return null;
  return {
    userId: person.id,
    mode: l.mode,
    shareUntil: null,
    updatedAt: l.updatedAt,
    lat: l.lat,
    lng: l.lng,
    accuracy: l.accuracy,
    battery: null,
    charging: null,
    speed: null,
    heading: null,
    placeId: person.place ? person.id : null,
    placeSince: l.placeSince,
    trip: null,
    blurRadiusM: l.blurRadiusM,
  };
}

function asPlace(person: SharedPerson): Place | undefined {
  if (!person.place) return undefined;
  return { id: person.id, name: person.place.name, kind: person.place.kind, note: null, lat: 0, lng: 0, radiusM: 0, rewardAmount: null };
}

function whenText(iso: string) {
  return `${friendlyDay(zoned(iso))} ${timeOf(iso)}`;
}

export default function SharedMapPage() {
  const { token } = useParams<{ token: string }>();
  const path = encodeURIComponent(token);
  const [stage, setStage] = useState<Stage>('loading');
  // Held only in memory: opening the link again, or reloading, asks for the PIN again.
  const [view, setView] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [map, setMap] = useState<SharedMap | null>(null);
  const [offline, setOffline] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const { status, data } = await call(`${path}/status`);
      if (status === 410) return setStage('locked');
      if (status !== 200) return setStage('gone');
      setLabel(data.label);
      setStage(data.pinSet ? 'enter' : 'choose');
    } catch {
      setOffline(true);
    }
  }, [path]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const load = useCallback(async () => {
    if (!view) return;
    try {
      const { status, data } = await call(path, { view });
      if (status === 200) {
        setMap(data);
        setOffline(false);
        return;
      }
      // Turned off, locked, ended, or this PIN's time ran out: start over from the link itself.
      setView(null);
      setMap(null);
      await checkStatus();
    } catch {
      setOffline(true);
    }
  }, [path, view, checkStatus]);

  useEffect(() => {
    if (view) load();
  }, [view, load]);
  useAutoRefresh(load, REFRESH_MS);

  // The page ends with the link, without waiting for the next refresh.
  useEffect(() => {
    if (!map) return;
    const left = new Date(map.expiresAt).getTime() - Date.now();
    const timer = window.setTimeout(() => {
      setView(null);
      setMap(null);
      setStage('gone');
    }, Math.max(0, Math.min(left, 2 ** 31 - 1)));
    return () => window.clearTimeout(timer);
  }, [map]);

  const unlocked = (viewToken: string) => {
    setView(viewToken);
    setStage('map');
  };

  if (stage === 'loading') return <main className="share-page share-message" />;
  if (stage === 'gone' || stage === 'locked') {
    const locked = stage === 'locked';
    return (
      <main className="share-page share-message">
        <span className="share-message-icon" aria-hidden="true">
          {locked ? '🔒' : '⌛'}
        </span>
        <h1>{t(locked ? 'share.lockedTitle' : 'share.goneTitle')}</h1>
        <p>{t(locked ? 'share.lockedHint' : 'share.goneHint')}</p>
      </main>
    );
  }
  if (stage !== 'map') {
    return <PinScreen path={path} stage={stage} label={label} setStage={setStage} onUnlocked={unlocked} />;
  }
  return <SharedMapView map={map} view={view} path={path} offline={offline} />;
}

function PinScreen({
  path,
  stage,
  label,
  setStage,
  onUnlocked,
}: {
  path: string;
  stage: 'choose' | 'confirm' | 'enter';
  label: string | null;
  setStage: (stage: Stage) => void;
  onUnlocked: (viewToken: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPin('');
    input.current?.focus();
  }, [stage]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!/^\d{4}$/.test(pin) || busy) return;
    if (stage === 'choose') {
      setChosen(pin);
      setError('');
      setStage('confirm');
      return;
    }
    if (stage === 'confirm' && pin !== chosen) {
      setError(t('share.pinMismatch'));
      setChosen('');
      setStage('choose');
      return;
    }
    setBusy(true);
    try {
      const { status, data } = await call(`${path}/pin/${stage === 'confirm' ? 'set' : 'verify'}`, { method: 'POST', body: { pin } });
      if (status === 200 || status === 201) return onUnlocked(data.viewToken);
      if (status === 409 && stage === 'confirm') {
        setError(t('share.alreadySet'));
        setStage('enter');
      } else if (status === 403) {
        setError(tn('share.wrongPin', data?.attemptsLeft ?? 1));
        setPin('');
        input.current?.focus();
      } else if (status === 410) {
        setStage('locked');
      } else if (status === 404) {
        setStage('gone');
      } else {
        setError(t('common.somethingWrong'));
      }
    } catch {
      setError(t('share.offline'));
    } finally {
      setBusy(false);
    }
  }

  // Four digits are the whole answer: no need to look for a button.
  useEffect(() => {
    if (pin.length === 4) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const title = stage === 'enter' ? t('share.enterPinTitle') : stage === 'confirm' ? t('share.confirmPin') : t('share.choosePinTitle');
  const hint = stage === 'enter' ? t('share.enterPinHint') : t('share.choosePinHint');

  return (
    <main className="share-page share-message">
      <span className="share-message-icon" aria-hidden="true">
        📍
      </span>
      {label && <p className="share-label"><bdi>{label}</bdi></p>}
      <h1>{title}</h1>
      <p>{hint}</p>
      <form className="share-pin-form" onSubmit={submit}>
        <input
          ref={input}
          className="share-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{4}"
          maxLength={4}
          dir="ltr"
          aria-label={t('share.pinLabel')}
          value={pin}
          readOnly={busy}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        <div className="share-pin-dots" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < pin.length ? 'is-filled' : ''} />
          ))}
        </div>
      </form>
      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

// Pictures need the view header, so they're fetched here and handed to the map as object URLs.
function useAvatars(people: SharedPerson[], path: string, view: string | null) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const made = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!view) return;
    for (const person of people) {
      if (!person.avatarAt) continue;
      const key = `${person.id}|${person.avatarAt}`;
      if (made.current[key] !== undefined) continue;
      made.current[key] = '';
      fetch(`/api/share/location/${path}/avatars/${encodeURIComponent(person.id)}`, { headers: { 'X-Share-View': view }, credentials: 'omit' })
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          made.current[key] = url;
          setUrls((current) => ({ ...current, [key]: url }));
        })
        .catch(() => undefined);
    }
  }, [people, path, view]);

  useEffect(() => {
    const all = made.current;
    return () => Object.values(all).forEach((url) => url && URL.revokeObjectURL(url));
  }, []);

  return (person: SharedPerson) => (person.avatarAt ? urls[`${person.id}|${person.avatarAt}`] ?? null : null);
}

function SharedMapView({ map, view, path, offline }: { map: SharedMap | null; view: string | null; path: string; offline: boolean }) {
  const people = map?.people ?? NONE;
  const avatarOf = useAvatars(people, path, view);

  const mapPeople = useMemo(
    () =>
      people.flatMap((person): MapPerson[] => {
        const location = asLocation(person);
        if (!location || location.lat === null || location.lng === null) return [];
        return [
          {
            id: person.id,
            displayName: person.displayName,
            avatarAt: person.avatarAt,
            avatarSrc: avatarOf(person),
            lat: location.lat,
            lng: location.lng,
            stale: isStale(location),
            emoji: pulseOf(location, asPlace(person)).emoji,
            eta: null,
            speedText: null,
            heading: null,
            blurRadiusM: location.blurRadiusM,
          },
        ];
      }),
    [people, avatarOf],
  );

  const noop = useCallback(() => undefined, []);

  return (
    <main className="share-page">
      <header className="share-head">
        <div>
          <h1>{map?.label ? <bdi>{map.label}</bdi> : t('share.title')}</h1>
          <p className="share-sub">
            <span className="share-live-dot" aria-hidden="true" /> {t('share.live')}
          </p>
        </div>
        {map && <p className="share-sub share-ends">{t('share.endsAt', { time: whenText(map.expiresAt) })}</p>}
      </header>
      {offline && <p className="callout callout-warn">{t('share.offline')}</p>}

      <FamilyMap
        people={mapPeople}
        places={NONE}
        errands={NONE}
        things={NONE}
        focus={null}
        pick={null}
        onPick={noop}
        onPerson={noop}
        onTogether={noop}
        onPlace={noop}
        onErrand={noop}
        onThing={noop}
      />

      <ul className="share-people">
        {people.map((person) => {
          const location = asLocation(person);
          const src = avatarOf(person);
          const status = !location
            ? t('share.notSharing')
            : location.mode === 'paused'
              ? t('share.paused')
              : [pulseOf(location, asPlace(person)).label, location.mode === 'blurred' ? t('share.nearby') : null].filter(Boolean).join(' · ');
          return (
            <li key={person.id} className="share-person">
              <span className="avatar" style={{ ['--hue' as any]: hueFor(person.id), width: 40, height: 40, fontSize: 16 }} aria-hidden="true">
                {src ? <img src={src} alt="" /> : initials(person.displayName)}
              </span>
              <span className="row-main">
                <span className="row-title">
                  <bdi>{firstName(person.displayName)}</bdi>
                </span>
                <span className="row-sub">
                  {status}
                  {location && location.mode !== 'paused' && ` · ${t('share.updated', { time: relativeTime(location.updatedAt) })}`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
