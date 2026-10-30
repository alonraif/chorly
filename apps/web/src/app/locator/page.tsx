'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { firstName, relativeTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useLocationSharing, type FamilyLocation } from '../../lib/location';
import { nativePlugins } from '../../lib/native';
import { useAutoRefresh } from '../../lib/refresh';
import { useSession, type Member } from '../../lib/session';
import { Avatar } from '../../components/avatar';
import { FamilyMap, type MapPerson } from '../../components/family-map';
import { errorMessage, Switch, useUi } from '../../components/ui';

const REFRESH_MS = 5_000;
// Past this, the person is shown faded: it's where they were, not where they are.
const STALE_MS = 10 * 60_000;
const JUST_NOW_MS = 60_000;

function lastSeen(iso: string) {
  return Date.now() - new Date(iso).getTime() < JUST_NOW_MS ? t('locator.justNow') : relativeTime(iso);
}

export default function LocatorPage() {
  const { me, people } = useSession();
  const { status, start, stop } = useLocationSharing();
  const { toast } = useUi();
  const [locations, setLocations] = useState<FamilyLocation[]>([]);
  const [focus, setFocus] = useState<{ id: string } | null>(null);

  const load = useCallback(() => {
    api.get('/location').then(setLocations).catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  useAutoRefresh(load, REFRESH_MS);

  const byId = useMemo(() => new Map(locations.map((l) => [l.userId, l])), [locations]);
  const mapPeople = useMemo(
    () =>
      people.flatMap((person): MapPerson[] => {
        const location = byId.get(person.id);
        if (!location) return [];
        const stale = Date.now() - new Date(location.updatedAt).getTime() > STALE_MS;
        return [{ id: person.id, displayName: person.displayName, avatarAt: person.avatarAt, lat: location.lat, lng: location.lng, stale }];
      }),
    [people, byId],
  );

  async function toggleSharing(on: boolean) {
    if (on) {
      start();
      return;
    }
    try {
      await stop();
      load();
    } catch (err) {
      toast(errorMessage(err, t('locator.stopFailed')), 'error');
    }
  }

  const sharedHint = status === 'denied' ? t('locator.denied') : t(nativePlugins() ? 'locator.shareHintNative' : 'locator.shareHint');

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t('locator.title')}</h1>
          <p className="muted">{t('locator.subtitle')}</p>
        </div>
      </header>

      <div className="locator-share">
        {status === 'unsupported' ? (
          <p className="muted">{t('locator.unsupported')}</p>
        ) : (
          <Switch checked={status === 'on'} onChange={toggleSharing} label={t('locator.share')} hint={sharedHint} />
        )}
      </div>

      <FamilyMap people={mapPeople} focus={focus} />

      <ul className="locator-people">
        {people.map((person: Member) => {
          const location = byId.get(person.id);
          const name = person.id === me.id ? t('locator.you', { name: firstName(person.displayName) }) : person.displayName;
          return (
            <li key={person.id}>
              <button type="button" className="locator-person" disabled={!location} onClick={() => setFocus({ id: person.id })}>
                <Avatar user={person} size={36} />
                <span className="locator-person-text">
                  <span className="locator-person-name">{name}</span>
                  <span className="field-hint">{location ? lastSeen(location.updatedAt) : t('locator.notSharing')}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
