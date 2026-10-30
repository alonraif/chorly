'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { distanceM } from '@chorly/shared';
import { api } from '../../lib/api';
import { firstName, relativeTime, timeOf } from '../../lib/format';
import { listJoin, t, tn } from '../../lib/i18n';
import { useLocationSharing } from '../../lib/location';
import { nativePlugins } from '../../lib/native';
import {
  batteryChip,
  directionsUrl,
  distanceText,
  isStale,
  minutesText,
  pulseOf,
  stayText,
  togetherGroups,
  tripMinutes,
  type Overview,
  type PersonLocation,
} from '../../lib/places';
import { useAutoRefresh } from '../../lib/refresh';
import { useSession, type Member } from '../../lib/session';
import { Avatar } from '../../components/avatar';
import { FamilyMap, type MapFocus, type MapPerson } from '../../components/family-map';
import { Icon } from '../../components/icon';
import { ErrandsSheet, PersonSheet, PlacesSheet, SharingSheet, TagsSheet, TripSheet, type RequestPick } from '../../components/locator-sheets';
import { Spinner, Switch } from '../../components/ui';

const REFRESH_MS = 5_000;
// Reports come every 30 seconds or so; anything newer than this is simply live.
const LIVE_MS = 2 * 60_000;

type SheetName = 'sharing' | 'places' | 'errands' | 'things' | 'trip';
type Point = { lat: number; lng: number };
type Picking = { apply: (point: Point) => void; point: Point | null; radiusM?: number };

const EMPTY: Overview = { locations: [], places: [], errands: [], tags: [], mine: { mode: 'exact', shareUntil: null, recap: false } };

const hasPosition = (location: PersonLocation | undefined): location is PersonLocation & Point => !!location && location.lat !== null && location.lng !== null;

export default function LocatorPage() {
  const { me, people, currency } = useSession();
  const { status: sharing } = useLocationSharing();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // While set, the sheets step aside and the viewer places a pin, then confirms it.
  const [picking, setPicking] = useState<Picking | null>(null);
  const flights = useRef(0);
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

  const flyTo = useCallback((point: Point) => {
    flights.current += 1;
    setFocus({ key: flights.current, lat: point.lat, lng: point.lng });
    // From further down the list the map would move out of sight.
    mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

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
  const sharedHint = sharing === 'denied' ? t('locator.denied') : t(elsewhere ? 'locator.sharingElsewhere' : nativePlugins() ? 'locator.shareHintNative' : 'locator.shareHint');
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
    const staying = place && location.placeSince && !isStale(location) && (location.speed ?? 0) < 1;
    return [pulseOf(location, place).label, staying ? t('locator.forStay', { time: stayText(location.placeSince!) }) : null, when].filter(Boolean).join(' · ');
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
  const selectedDistance =
    hasPosition(selectedLocation) && hasPosition(myLocation) && !isStale(myLocation) ? distanceText(distanceM(myLocation, selectedLocation)) : null;

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('locator.title')}</h1>
      </header>

      {sharingNow ? (
        <div className="locator-share is-on">
          <span className="locator-share-text">
            <span className="locator-share-title">
              {mine.mode === 'paused' ? `🔒 ${t('locator.paused')}` : mine.mode === 'blurred' ? `🌫️ ${t('locator.sharingNearby')}` : `📡 ${t('locator.sharingExact')}`}
            </span>
            <span className="field-hint">{mine.shareUntil ? t('locator.endsAt', { time: timeOf(mine.shareUntil) }) : t('locator.untilIStop')}</span>
          </span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSheet('sharing')}>
            {t('locator.change')}
          </button>
        </div>
      ) : (
        <div className={`locator-share${sharing === 'denied' ? ' is-blocked' : ''}`}>
          {sharing === 'unsupported' ? (
            <p className="muted">{t('locator.unsupported')}</p>
          ) : (
            <Switch checked={false} onChange={() => setSheet('sharing')} label={t('locator.share')} hint={sharedHint} />
          )}
        </div>
      )}

      <div className="locator-toolbar" role="toolbar" aria-label={t('locator.title')}>
        {sharingNow && mine.mode !== 'paused' && (
          <button type="button" className={`chip-btn${myTrip ? ' is-active' : ''}`} onClick={() => setSheet('trip')}>
            <span aria-hidden="true">🧭</span>{' '}
            {myTrip && myTripMinutes ? t('locator.etaBubble', { place: myTrip.name, time: minutesText(myTripMinutes) }) : t('locator.headingTo')}
          </button>
        )}
        <button type="button" className="chip-btn" onClick={() => setSheet('places')}>
          <span aria-hidden="true">📍</span> {t('locator.places')}
          {places.length > 0 && <span className="chip-count">{places.length}</span>}
        </button>
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
          focus={focus}
          pick={picking && { point: picking.point, radiusM: picking.radiusM }}
          onPick={(point) => setPicking((current) => current && { ...current, point })}
          onPerson={(id) => (id === me.id ? setSheet('sharing') : setSelectedId(id))}
          onPlace={() => setSheet('places')}
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
                  onClick={() => (mineRow ? hasPosition(location) && flyTo(location) : setSelectedId(person.id))}
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

      <SharingSheet open={sheetOpen('sharing')} onClose={() => setSheet(null)} mine={mine} onChanged={load} />
      <PlacesSheet
        open={sheetOpen('places')}
        onClose={() => setSheet(null)}
        places={places}
        isAdmin={me.isAdmin}
        currency={currency}
        onPick={requestPick}
        onChanged={load}
        onShow={flyTo}
      />
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
      <PersonSheet
        person={selected}
        status={statusOf(selectedLocation)}
        chips={selected ? chipsOf(selected) : null}
        distance={selectedDistance}
        directions={hasPosition(selectedLocation) && selectedLocation.mode === 'exact' ? directionsUrl(selectedLocation) : null}
        onShow={
          hasPosition(selectedLocation)
            ? () => {
                setSelectedId(null);
                flyTo(selectedLocation);
              }
            : null
        }
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
