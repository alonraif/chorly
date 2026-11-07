'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { timeOf } from '../lib/format';
import { t } from '../lib/i18n';
import { useLocationSharing } from '../lib/location';
import { isStale, type Overview } from '../lib/places';
import { useSession } from '../lib/session';
import { Icon } from './icon';
import { PlacesSheet, SharingSheet } from './locator-sheets';

// Location sharing and the family's places, under Account: settings, not things to look at on the map.
export function LocationRows({ active }: { active: boolean }) {
  const { me, currency } = useSession();
  const { status: sharing } = useLocationSharing();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [open, setOpen] = useState<'sharing' | 'places' | null>(null);

  const load = useCallback(() => {
    api.get('/location/overview').then(setOverview).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const mine = overview?.mine ?? { mode: 'exact' as const, shareUntil: null, recap: false, trail: true };
  const places = overview?.places ?? [];
  const myLocation = overview?.locations.find((l) => l.userId === me.id);
  const sharingNow = sharing === 'on';
  const elsewhere = !sharingNow && !!myLocation && !isStale(myLocation);

  const sharingHint = !sharingNow
    ? t(elsewhere ? 'locator.chipElsewhere' : 'locator.notSharing')
    : mine.mode === 'paused'
      ? t('locator.chipPaused')
      : mine.shareUntil
        ? t('locator.chipUntil', { time: timeOf(mine.shareUntil) })
        : t(mine.mode === 'blurred' ? 'locator.nearbyOnly' : 'locator.chipOn');

  return (
    <>
      {sharing !== 'unsupported' && (
        <button type="button" className="setting-row setting-button" onClick={() => setOpen('sharing')} disabled={!overview}>
          <span className="setting-icon">
            <Icon name="pin" size={18} />
          </span>
          <span className="setting-text">
            <span className="setting-label">{t('locator.sharingTitle')}</span>
            <span className="field-hint">{overview ? sharingHint : ' '}</span>
          </span>
          <span className="row-chevron">
            <Icon name="chevronRight" size={18} />
          </span>
        </button>
      )}
      <button type="button" className="setting-row setting-button" onClick={() => setOpen('places')} disabled={!overview}>
        <span className="setting-icon">
          <Icon name="home" size={18} />
        </span>
        <span className="setting-text">
          <span className="setting-label">{t('locator.places')}</span>
          <span className="field-hint">{t('locator.placesHint')}</span>
        </span>
        <span className="row-chevron">
          <Icon name="chevronRight" size={18} />
        </span>
      </button>

      <SharingSheet open={open === 'sharing'} onClose={() => setOpen(null)} mine={mine} elsewhere={elsewhere} onChanged={load} />
      <PlacesSheet open={open === 'places'} onClose={() => setOpen(null)} places={places} isAdmin={me.isAdmin} currency={currency} onChanged={load} />
    </>
  );
}
