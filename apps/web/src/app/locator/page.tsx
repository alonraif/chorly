'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { firstName, relativeTime, timeOf } from '../../lib/format';
import { joinNames, t, tn } from '../../lib/i18n';
import { useLocationSharing } from '../../lib/location';
import { nativePlugins } from '../../lib/native';
import {
  batteryChip,
  isStale,
  minutesText,
  pulseOf,
  stayText,
  togetherGroups,
  tripMinutes,
  type Overview,
} from '../../lib/places';
import { useAutoRefresh } from '../../lib/refresh';
import { useSession, type Member } from '../../lib/session';
import { Avatar } from '../../components/avatar';
import { FamilyMap, type MapFocus, type MapPerson } from '../../components/family-map';
import { Icon } from '../../components/icon';
import { ErrandsSheet, PlacesSheet, PokeSheet, SharingSheet, TagsSheet, TripSheet, type RequestPick } from '../../components/locator-sheets';
import { Switch } from '../../components/ui';

const REFRESH_MS = 5_000;
const JUST_NOW_MS = 60_000;

type SheetName = 'sharing' | 'places' | 'errands' | 'things' | 'trip';

const EMPTY: Overview = { locations: [], places: [], errands: [], tags: [], mine: { mode: 'exact', shareUntil: null, recap: false } };

function lastSeen(iso: string) {
  return Date.now() - new Date(iso).getTime() < JUST_NOW_MS ? t('locator.justNow') : relativeTime(iso);
}

export default function LocatorPage() {
  const { me, people, currency } = useSession();
  const { status } = useLocationSharing();
  const [overview, setOverview] = useState<Overview>(EMPTY);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [poking, setPoking] = useState<Member | null>(null);
  // While set, the sheets step aside and the next tap on the map is handed to `apply`.
  const [picking, setPicking] = useState<{ apply: (point: { lat: number; lng: number }) => void } | null>(null);
  const flights = useRef(0);

  const load = useCallback(() => {
    api.get('/location/overview').then(setOverview).catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  useAutoRefresh(load, REFRESH_MS);

  const { locations, places, errands, tags, mine } = overview;
  const byId = useMemo(() => new Map(locations.map((l) => [l.userId, l])), [locations]);
  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const mapPeople = useMemo(
    () =>
      people.flatMap((person): MapPerson[] => {
        const location = byId.get(person.id);
        if (!location || location.lat === null || location.lng === null) return [];
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

  const together = useMemo(() => togetherGroups(locations), [locations]);

  const flyTo = useCallback((point: { lat: number; lng: number }) => {
    flights.current += 1;
    setFocus({ key: flights.current, lat: point.lat, lng: point.lng });
  }, []);

  const requestPick: RequestPick = useCallback((apply) => setPicking({ apply }), []);

  const sharingNow = status === 'on';
  const sharedHint = status === 'denied' ? t('locator.denied') : t(nativePlugins() ? 'locator.shareHintNative' : 'locator.shareHint');
  const myLocation = byId.get(me.id);
  const nameOf = (id: string) => firstName(personById.get(id)?.displayName ?? '');
  const sheetOpen = (name: SheetName) => sheet === name && !picking;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t('locator.title')}</h1>
          <p className="muted">{t('locator.subtitle')}</p>
        </div>
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
        <div className="locator-share">
          {status === 'unsupported' ? (
            <p className="muted">{t('locator.unsupported')}</p>
          ) : (
            <Switch checked={false} onChange={() => setSheet('sharing')} label={t('locator.share')} hint={sharedHint} />
          )}
        </div>
      )}

      <div className="locator-toolbar" role="toolbar" aria-label={t('locator.title')}>
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
        {sharingNow && mine.mode !== 'paused' && (
          <button type="button" className="chip-btn" onClick={() => setSheet('trip')}>
            <span aria-hidden="true">🧭</span> {t(myLocation?.trip ? 'locator.onMyWay' : 'locator.headingTo')}
          </button>
        )}
      </div>

      {picking && (
        <div className="pick-banner" role="status">
          <span>{t('locator.pickBanner')}</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setPicking(null)}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      <FamilyMap
        people={mapPeople}
        places={places}
        errands={errands.map((e) => ({ id: e.id, title: e.title, lat: e.lat, lng: e.lng, claimed: !!e.claimedById }))}
        things={tags}
        focus={focus}
        picking={!!picking}
        onPick={(point) => {
          picking?.apply(point);
          setPicking(null);
        }}
        onPerson={(id) => {
          const person = personById.get(id);
          if (person && id !== me.id) setPoking(person);
        }}
        onPlace={() => setSheet('places')}
        onErrand={() => setSheet('errands')}
        onThing={() => setSheet('things')}
      />

      {together.map((group) => (
        <p key={group.join()} className="together">
          🤝 {t('locator.together', { names: joinNames(group.map((id) => (id === me.id ? t('locator.youShort') : nameOf(id)))) })}
        </p>
      ))}

      <ul className="locator-people">
        {people.map((person: Member) => {
          const location = byId.get(person.id);
          const name = person.id === me.id ? t('locator.you', { name: firstName(person.displayName) }) : person.displayName;
          const place = location?.placeId ? placeById.get(location.placeId) : undefined;
          const pulse = location ? pulseOf(location, place) : null;
          const battery = location ? batteryChip(location) : null;
          const minutes = location ? tripMinutes(location) : null;
          const trip = location?.trip ? placeById.get(location.trip.placeId) : undefined;
          const hidden = !location || location.lat === null || location.lng === null;
          const status =
            !location
              ? t('locator.notSharing')
              : location.mode === 'paused'
                ? t('locator.pausedSince', { when: lastSeen(location.updatedAt) })
                : [
                    pulse?.label,
                    place && location.placeSince && (location.speed ?? 0) < 1 ? stayText(location.placeSince) : null,
                    lastSeen(location.updatedAt),
                  ]
                    .filter(Boolean)
                    .join(' · ');
          return (
            <li key={person.id} className="locator-row">
              <button
                type="button"
                className="locator-person"
                disabled={hidden}
                onClick={() => location && location.lat !== null && location.lng !== null && flyTo({ lat: location.lat, lng: location.lng })}
              >
                <span className="locator-avatar">
                  <Avatar user={person} size={36} />
                  {pulse && <span className="locator-pulse" aria-hidden="true">{pulse.emoji}</span>}
                </span>
                <span className="locator-person-text">
                  <span className="locator-person-name">{name}</span>
                  <span className="field-hint">{status}</span>
                  {(battery || (trip && minutes) || location?.mode === 'blurred') && (
                    <span className="mini-chips">
                      {battery && <span className={`mini-chip${battery.low ? ' is-warn' : ''}`}>{battery.text}</span>}
                      {trip && minutes && <span className="mini-chip">{`🧭 ${t('locator.etaBubble', { place: trip.name, time: minutesText(minutes) })}`}</span>}
                      {location?.mode === 'blurred' && <span className="mini-chip">🌫️ {t('locator.nearbyOnly')}</span>}
                    </span>
                  )}
                </span>
              </button>
              {person.id !== me.id && (
                <button type="button" className="icon-btn" aria-label={t('locator.pokeTitle', { name: firstName(person.displayName) })} onClick={() => setPoking(person)}>
                  <span aria-hidden="true">👋</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {errands.some((e) => e.closest?.userId === me.id && !e.claimedById) && (
        <p className="together">🛒 {tn('locator.closestToYou', errands.filter((e) => e.closest?.userId === me.id && !e.claimedById).length)}</p>
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
      <TagsSheet open={sheetOpen('things')} onClose={() => setSheet(null)} tags={tags} onPick={requestPick} onChanged={load} onShow={flyTo} />
      <TripSheet open={sheetOpen('trip')} onClose={() => setSheet(null)} places={places} heading={!!myLocation?.trip} onChanged={load} />
      <PokeSheet target={poking} onClose={() => setPoking(null)} />
    </div>
  );
}
