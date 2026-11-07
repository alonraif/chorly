'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { distanceM } from '@chorly/shared';
import { api } from '../../lib/api';
import { firstName, relativeTime, timeOf } from '../../lib/format';
import { listJoin, t, tn } from '../../lib/i18n';
import { nativeReady, useLocationSharing } from '../../lib/location';
import { nativePlugins } from '../../lib/native';
import {
  batteryChip,
  directionsUrl,
  distanceText,
  isStale,
  minutesText,
  movingSpeed,
  pulseOf,
  speedText,
  stayText,
  togetherGroups,
  tripMinutes,
  type Overview,
  type PersonLocation,
  type TrailPoint,
} from '../../lib/places';
import { useAutoRefresh } from '../../lib/refresh';
import { useSession, type Member } from '../../lib/session';
import { Avatar, hueFor } from '../../components/avatar';
import { FamilyMap, PERSON_ZOOM, type MapFocus, type MapPerson } from '../../components/family-map';
import { Icon } from '../../components/icon';
import { ErrandsSheet, PersonSheet, SharingSheet, TagsSheet, TripSheet, type RequestPick } from '../../components/locator-sheets';
import { Sheet, Spinner, Switch, useUi } from '../../components/ui';

const REFRESH_MS = 5_000;
// Reports come every 30 seconds or so; anything newer than this is simply live.
const LIVE_MS = 2 * 60_000;

type SheetName = 'sharing' | 'errands' | 'things' | 'trip';
type Point = { lat: number; lng: number };
type Picking = { apply: (point: Point) => void; point: Point | null; radiusM?: number };

const EMPTY: Overview = { locations: [], places: [], errands: [], tags: [], mine: { mode: 'exact', shareUntil: null, recap: false, trail: true } };
// "Check in now" waits this long for the phone's answer before saying there was none.
const CHECK_IN_WAIT_MS = 60_000;

const hasPosition = (location: PersonLocation | undefined): location is PersonLocation & Point => !!location && location.lat !== null && location.lng !== null;

export default function LocatorPage() {
  const { me, people } = useSession();
  const { status: sharing, native } = useLocationSharing();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // While set, the sheets step aside and the viewer places a pin, then confirms it.
  const [picking, setPicking] = useState<Picking | null>(null);
  const flights = useRef(0);
  const { toast } = useUi();
  const [trail, setTrail] = useState<{ userId: string; points: TrailPoint[] } | null>(null);
  // People together at one spot, tapped on the map: which of them to look at.
  const [togetherIds, setTogetherIds] = useState<string[] | null>(null);
  // Waiting for a phone to answer "check in now": who, and how old their position was when asked.
  const [checking, setChecking] = useState<{ userId: string; since: string | null } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get('/location/overview').then(setOverview).catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  useAutoRefresh(load, REFRESH_MS);

  // A push about an errand lands on the errands.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('sheet') === 'errands') setSheet('errands');
  }, []);

  const { locations, places, errands, tags, mine } = overview ?? EMPTY;
  const byId = useMemo(() => new Map(locations.map((l) => [l.userId, l])), [locations]);
  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const mapPeople = useMemo(
    () =>
      people.flatMap((person): MapPerson[] => {
        const location = byId.get(person.id);
        if (!hasPosition(location)) return [];
        const minutes = tripMinutes(location);
        const trip = location.trip ? placeById.get(location.trip.placeId) : undefined;
        return [
          {
            id: person.id,
            displayName: person.displayName,
            avatarAt: person.avatarAt,
            lat: location.lat,
            lng: location.lng,
            stale: isStale(location),
            emoji: pulseOf(location, location.placeId ? placeById.get(location.placeId) : undefined).emoji,
            eta: trip && minutes ? t('locator.etaBubble', { place: trip.name, time: minutesText(minutes) }) : null,
            speedText: speedText(location),
            heading: movingSpeed(location) !== null ? location.heading : null,
            blurRadiusM: location.blurRadiusM,
          },
        ];
      }),
    [people, byId, placeById],
  );

  // You first, then whoever can be seen, then everyone else.
  const listed = useMemo(() => {
    const rank = (person: Member) => (person.id === me.id ? 0 : hasPosition(byId.get(person.id)) ? 1 : byId.has(person.id) ? 2 : 3);
    return [...people].sort((a, b) => rank(a) - rank(b));
  }, [people, byId, me.id]);

  const together = useMemo(() => togetherGroups(locations), [locations]);

  const flyTo = useCallback((point: Point, options?: { zoom?: number; lift?: boolean }) => {
    flights.current += 1;
    setFocus({ key: flights.current, lat: point.lat, lng: point.lng, ...options });
    // From further down the list the map would move out of sight. With a card coming up over the
    // bottom of the screen, the map goes to the top.
    mapRef.current?.scrollIntoView({ behavior: 'smooth', block: options?.lift ? 'start' : 'center' });
  }, []);

  // A tap on someone, in the list or on the map: straight to them, with their card open.
  const openPerson = useCallback(
    (id: string) => {
      const location = byId.get(id);
      if (hasPosition(location)) flyTo(location, { zoom: PERSON_ZOOM, lift: id !== me.id });
      if (id !== me.id) setSelectedId(id);
    },
    [byId, flyTo, me.id],
  );

  const requestPick: RequestPick = useCallback(
    (apply, options) => {
      setPicking({ apply, point: options?.start ?? null, radiusM: options?.radiusM });
      if (options?.start) flyTo(options.start);
      else mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [flyTo],
  );

  const sharingNow = sharing === 'on';
  const myLocation = byId.get(me.id);
  const elsewhere = !sharingNow && !!myLocation && !isStale(myLocation);
  // Asked once: after that the toolbar keeps the state in view without taking up the page. Waits for the overview, which says.
  const askToShare = !!overview && !sharingNow && (sharing === 'denied' || !myLocation);
  const myTrip = myLocation?.trip ? placeById.get(myLocation.trip.placeId) : undefined;
  const myTripMinutes = myLocation ? tripMinutes(myLocation) : null;
  const nearErrands = errands.filter((e) => e.closest?.userId === me.id).length;
  const sheetOpen = (name: SheetName) => sheet === name && !picking;

  const nameOf = (id: string) => (id === me.id ? t('locator.youStart') : firstName(personById.get(id)?.displayName ?? ''));

  function statusOf(location: PersonLocation | undefined) {
    if (!location) return t('locator.notSharing');
    const age = Date.now() - new Date(location.updatedAt).getTime();
    const when = age < LIVE_MS ? null : relativeTime(location.updatedAt);
    if (location.mode === 'paused') return when ? t('locator.pausedSince', { when }) : t('pulse.paused');
    const place = location.placeId ? placeById.get(location.placeId) : undefined;
    const speed = speedText(location);
    const staying = place && location.placeSince && !isStale(location) && !speed;
    return [pulseOf(location, place).label, speed, staying ? t('locator.forStay', { time: stayText(location.placeSince!) }) : null, when].filter(Boolean).join(' · ');
  }

  function chipsOf(person: Member) {
    const location = byId.get(person.id);
    if (!location) return null;
    const battery = batteryChip(location);
    const minutes = tripMinutes(location);
    const trip = location.trip ? placeById.get(location.trip.placeId) : undefined;
    if (!battery && !(trip && minutes) && location.mode !== 'blurred') return null;
    return (
      <span className="mini-chips">
        {battery && <span className={`mini-chip${battery.low ? ' is-warn' : ''}`}>{battery.text}</span>}
        {trip && minutes && <span className="mini-chip">{`🧭 ${t('locator.etaBubble', { place: trip.name, time: minutesText(minutes) })}`}</span>}
        {location.mode === 'blurred' && <span className="mini-chip">🌫️ {t('locator.nearbyOnly')}</span>}
      </span>
    );
  }

  const selected = selectedId ? personById.get(selectedId) ?? null : null;
  const selectedLocation = selected ? byId.get(selected.id) : undefined;
  const selectedUpdatedAt = selectedLocation?.updatedAt;

  // A trail belongs to the open card: it goes when the card does, and grows while it's open.
  const trailFor = trail?.userId;
  useEffect(() => {
    if (trailFor && trailFor !== selectedId) setTrail(null);
  }, [trailFor, selectedId]);
  useEffect(() => {
    if (!trailFor || trailFor !== selectedId) return;
    api.get(`/location/trail/${trailFor}`).then((points: TrailPoint[]) => setTrail((current) => (current?.userId === trailFor ? { userId: trailFor, points } : current))).catch(() => undefined);
  }, [trailFor, selectedId, selectedUpdatedAt]);

  const toggleTrail = (id: string) => {
    if (trail?.userId === id) {
      setTrail(null);
      return;
    }
    api
      .get(`/location/trail/${id}`)
      .then((points: TrailPoint[]) => {
        if (points.length < 2) toast(t('locator.trailEmpty'), 'info');
        setTrail({ userId: id, points });
      })
      .catch(() => undefined);
  };

  // The answer to "check in now" is simply a newer position; no answer within a minute is said too.
  const checkingFor = checking?.userId;
  const checkedUpdatedAt = checkingFor ? byId.get(checkingFor)?.updatedAt : undefined;
  useEffect(() => {
    if (!checking || !checkedUpdatedAt || checkedUpdatedAt === checking.since) return;
    toast(t('locator.checkInDone', { name: firstName(personById.get(checking.userId)?.displayName ?? '') }));
    setChecking(null);
  }, [checking, checkedUpdatedAt, personById, toast]);
  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => {
      toast(t('locator.checkInNoAnswer', { name: firstName(personById.get(checking.userId)?.displayName ?? '') }), 'info');
      setChecking(null);
    }, CHECK_IN_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [checking, personById, toast]);
  const selectedDistance =
    hasPosition(selectedLocation) && hasPosition(myLocation) && !isStale(myLocation) ? distanceText(distanceM(myLocation, selectedLocation)) : null;

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('locator.title')}</h1>
      </header>

      {askToShare && (
        <div className={`locator-share${sharing === 'denied' ? ' is-blocked' : ''}`}>
          {sharing === 'unsupported' ? (
            <p className="muted">{t('locator.unsupported')}</p>
          ) : (
            <Switch checked={false} onChange={() => setSheet('sharing')} label={t('locator.share')} hint={t(sharing === 'denied' ? 'locator.denied' : nativePlugins() ? 'locator.shareHintNative' : 'locator.shareHint')} />
          )}
        </div>
      )}

      {sharingNow && mine.mode !== 'paused' && !nativeReady(native) && (
        <button type="button" className="locator-warning" onClick={() => setSheet('sharing')}>
          <span>⚠️ {t('locator.setupWarning')}</span>
          <span className="locator-warning-fix">{t('locator.setupFix')}</span>
        </button>
      )}

      <div className="locator-toolbar" role="toolbar" aria-label={t('locator.title')}>
        {sharingNow && mine.mode !== 'paused' && (
          <button type="button" className={`chip-btn${myTrip ? ' is-active' : ''}`} onClick={() => setSheet('trip')}>
            <span aria-hidden="true">🧭</span>{' '}
            {myTrip && myTripMinutes ? t('locator.etaBubble', { place: myTrip.name, time: minutesText(myTripMinutes) }) : t('locator.headingTo')}
          </button>
        )}
        <button type="button" className="chip-btn" onClick={() => setSheet('errands')}>
          <span aria-hidden="true">🛒</span> {t('locator.errands')}
          {errands.length > 0 && <span className="chip-count">{errands.length}</span>}
        </button>
        <button type="button" className="chip-btn" onClick={() => setSheet('things')}>
          <span aria-hidden="true">🐕</span> {t('locator.things')}
          {tags.length > 0 && <span className="chip-count">{tags.length}</span>}
        </button>
      </div>

      {picking && (
        <div className="pick-banner" role="status">
          <span>{t(picking.point ? 'locator.pickAdjust' : 'locator.pickBanner')}</span>
          <span className="row-gap">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setPicking(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!picking.point}
              onClick={() => {
                picking.apply(picking.point!);
                setPicking(null);
              }}
            >
              {t('locator.useThisSpot')}
            </button>
          </span>
        </div>
      )}

      <div ref={mapRef}>
        <FamilyMap
          people={mapPeople}
          places={places}
          errands={errands.map((e) => ({ id: e.id, title: e.title, lat: e.lat, lng: e.lng, claimed: !!e.claimedById }))}
          things={tags}
          trail={trail && trail.points.length >= 2 ? { key: trail.userId, hue: hueFor(trail.userId), points: trail.points } : null}
          focus={focus}
          pick={picking && { point: picking.point, radiusM: picking.radiusM }}
          onPick={(point) => setPicking((current) => current && { ...current, point })}
          onPerson={(id) => (id === me.id ? setSheet('sharing') : openPerson(id))}
          onTogether={setTogetherIds}
          onPlace={(id) => {
            const place = placeById.get(id);
            if (place) flyTo(place);
          }}
          onErrand={() => setSheet('errands')}
          onThing={() => setSheet('things')}
        />
      </div>

      {nearErrands > 0 && (
        <button type="button" className="together is-button" onClick={() => setSheet('errands')}>
          <span>🛒 {tn('locator.closestToYou', nearErrands)}</span>
          <Icon name="chevronRight" size={16} />
        </button>
      )}

      {together.map((group) => (
        <p key={group.join()} className="together">
          🤝 {t('locator.together', { names: listJoin([...group].sort((a, b) => Number(b === me.id) - Number(a === me.id)).map(nameOf)) })}
        </p>
      ))}

      {!overview ? (
        <p className="locator-loading">
          <Spinner />
        </p>
      ) : (
        <ul className="locator-people">
          {listed.map((person) => {
            const location = byId.get(person.id);
            const mineRow = person.id === me.id;
            const pulse = location ? pulseOf(location, location.placeId ? placeById.get(location.placeId) : undefined) : null;
            return (
              <li key={person.id} className="locator-row">
                <button
                  type="button"
                  className="locator-person"
                  disabled={mineRow && !hasPosition(location)}
                  onClick={() => openPerson(person.id)}
                >
                  <span className="locator-avatar">
                    <Avatar user={person} size={36} />
                    {pulse && <span className="locator-pulse" aria-hidden="true">{pulse.emoji}</span>}
                  </span>
                  <span className="locator-person-text">
                    <span className="locator-person-name">{mineRow ? t('locator.you', { name: firstName(person.displayName) }) : person.displayName}</span>
                    <span className="field-hint">{statusOf(location)}</span>
                    {chipsOf(person)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <SharingSheet open={sheetOpen('sharing')} onClose={() => setSheet(null)} mine={mine} elsewhere={elsewhere} onChanged={load} />
      <ErrandsSheet open={sheetOpen('errands')} onClose={() => setSheet(null)} errands={errands} people={people} me={me} onPick={requestPick} onChanged={load} onShow={flyTo} />
      <TagsSheet open={sheetOpen('things')} onClose={() => setSheet(null)} tags={tags} people={people} onPick={requestPick} onChanged={load} onShow={flyTo} />
      <TripSheet
        open={sheetOpen('trip')}
        onClose={() => setSheet(null)}
        places={places}
        herePlaceId={myLocation?.placeId ?? null}
        heading={myTrip && myTripMinutes ? { place: myTrip.name, minutes: myTripMinutes } : null}
        onChanged={load}
      />
      <Sheet open={!!togetherIds} onClose={() => setTogetherIds(null)} title={t('locator.togetherHere')} size="sm" backdrop="clear">
        <ul className="sheet-list">
          {listed
            .filter((person) => togetherIds?.includes(person.id))
            .map((person) => (
              <li key={person.id} className="sheet-list-item">
                <button
                  type="button"
                  className="locator-person"
                  onClick={() => {
                    setTogetherIds(null);
                    if (person.id === me.id) setSheet('sharing');
                    else openPerson(person.id);
                  }}
                >
                  <Avatar user={person} size={36} />
                  <span className="locator-person-text">
                    <span className="locator-person-name">{person.id === me.id ? t('locator.you', { name: firstName(person.displayName) }) : person.displayName}</span>
                    <span className="field-hint">{statusOf(byId.get(person.id))}</span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </Sheet>

      <PersonSheet
        person={selected}
        status={statusOf(selectedLocation)}
        chips={selected ? chipsOf(selected) : null}
        distance={selectedDistance}
        directions={hasPosition(selectedLocation) && selectedLocation.mode === 'exact' ? directionsUrl(selectedLocation) : null}
        onLocate={
          selected && selectedLocation && selectedLocation.mode !== 'paused'
            ? async () => {
                await api.post('/location/locate', { userId: selected.id });
                setChecking({ userId: selected.id, since: selectedLocation.updatedAt });
                // The answer should show without waiting for the next refresh.
                window.setTimeout(load, 8_000);
              }
            : null
        }
        trailShown={!!selected && trail?.userId === selected.id}
        trailNote={selected && trail?.userId === selected.id && trail.points.length >= 2 ? t('locator.trailSince', { time: timeOf(trail.points[0].at) }) : null}
        onTrail={selected && hasPosition(selectedLocation) && selectedLocation.mode === 'exact' ? () => toggleTrail(selected.id) : null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
