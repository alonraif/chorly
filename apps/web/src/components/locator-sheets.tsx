'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { POKE_KINDS } from '@chorly/shared';
import { api } from '../lib/api';
import { currencySymbol, firstName, relativeTime, timeOf } from '../lib/format';
import { getLocale, t, type MessageKey } from '../lib/i18n';
import { useLocationSharing } from '../lib/location';
import {
  distanceText,
  KIND_EMOJI,
  minutesText,
  minutesUntilTonight,
  PLACE_KINDS,
  TAG_EMOJIS,
  type Errand,
  type MapTag,
  type Overview,
  type Place,
  type PlaceKind,
  type SharingMode,
} from '../lib/places';
import type { Member } from '../lib/session';
import { Icon } from './icon';
import { errorMessage, Segmented, Sheet, Switch, useUi } from './ui';

type Point = { lat: number; lng: number };
// Asks the page to let the viewer place a pin; `apply` receives the confirmed spot.
export type RequestPick = (apply: (point: Point) => void, options?: { start?: Point | null; radiusM?: number }) => void;

// The API answers with codes where the reason is meant for the member, in their language.
const ERROR_TEXT: Record<string, MessageKey> = {
  poke_cooldown: 'locator.pokeCooldown',
  errand_taken: 'locator.errandTaken',
  not_your_errand: 'locator.notYourErrand',
  share_first: 'locator.shareFirst',
  already_there: 'locator.alreadyThere',
  geocode_failed: 'locator.addressFailed',
};

function currentPosition() {
  return new Promise<Point>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => reject(new Error(t('locator.cantLocate'))),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}

function useAction() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) toast(success);
      return true;
    } catch (err) {
      const code = err instanceof Error ? ERROR_TEXT[err.message] : undefined;
      toast(code ? t(code) : errorMessage(err, t('common.somethingWrong')), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

type AddressResult = Point & { label: string };

function AddressSearch({ near, onFound }: { near: Point | null; onFound: (point: Point) => void }) {
  const { busy, run } = useAction();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddressResult[] | null>(null);

  const search = () =>
    run(async () => {
      const body = { query: query.trim(), language: getLocale(), ...(near ? { near: { lat: near.lat, lng: near.lng } } : {}) };
      setResults(await api.post('/location/geocode', body));
    });

  const choose = ({ label, lat, lng }: AddressResult) => {
    setQuery(label);
    setResults(null);
    onFound({ lat, lng });
  };

  return (
    <div className="field">
      <label className="field-label-sm" htmlFor="place-address">{t('locator.address')}</label>
      <div className="address-search">
        <input
          id="place-address"
          className="input"
          value={query}
          maxLength={200}
          enterKeyHint="search"
          onChange={(e) => {
            setQuery(e.target.value);
            setResults(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!busy && query.trim().length >= 2) search();
          }}
          placeholder={t('locator.addressPlaceholder')}
        />
        <button type="button" className="btn btn-secondary" onClick={search} disabled={busy || query.trim().length < 2}>
          {t('locator.addressSearch')}
        </button>
      </div>
      {results?.length === 0 && <p className="field-hint">{t('locator.addressNone')}</p>}
      {results && results.length > 0 && (
        <ul className="sheet-list">
          {results.map((result) => (
            <li key={`${result.lat},${result.lng}`} className="sheet-list-item">
              <button type="button" className="sheet-list-main" onClick={() => choose(result)}>
                <span className="sheet-list-emoji">📍</span>
                <span className="sheet-list-text">{result.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PointField({ value, radiusM, onChange, onPick }: { value: Point | null; radiusM?: number; onChange: (point: Point) => void; onPick: RequestPick }) {
  const { busy: locating, run } = useAction();

  const useMine = () => run(async () => onChange(await currentPosition()));

  return (
    <div className="field">
      <span className="field-label-sm">{t('locator.spot')}</span>
      <p className={`field-hint${value ? ' point-set' : ''}`}>{value ? `📍 ${t('locator.spotSet')}` : t('locator.spotNotSet')}</p>
      <div className="row-gap">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPick(onChange, { start: value, radiusM })}>
          <Icon name="pin" size={16} /> {t('locator.pickOnMap')}
        </button>
        {'geolocation' in navigator && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={useMine} disabled={locating}>
            {t('locator.useMyLocation')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Sharing: who sees what, and for how long ----

type Duration = 'hour' | 'tonight' | 'always';
const DURATION_MINUTES = (duration: Duration) => (duration === 'hour' ? 60 : duration === 'tonight' ? minutesUntilTonight() : null);

export function SharingSheet({
  open,
  onClose,
  mine,
  elsewhere,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  mine: Overview['mine'];
  /** This device is off but another one is reporting: starting here takes over from it. */
  elsewhere: boolean;
  onChanged: () => void;
}) {
  const { status, start, stop, reportNow } = useLocationSharing();
  const { busy, run } = useAction();
  const [mode, setMode] = useState<'exact' | 'blurred'>('exact');
  const [duration, setDuration] = useState<Duration>('always');
  const [recap, setRecap] = useState(false);
  const on = status === 'on';

  useEffect(() => {
    if (open) setRecap(mine.recap);
  }, [open, mine.recap]);

  const durations = [
    { value: 'hour' as const, label: t('locator.forAnHour') },
    { value: 'tonight' as const, label: t('locator.untilTonight') },
    { value: 'always' as const, label: t('locator.untilIStop') },
  ];

  async function begin() {
    const ok = await run(() => start({ mode, durationMinutes: DURATION_MINUTES(duration), recap }));
    if (ok) {
      onChanged();
      onClose();
    }
  }

  async function change(body: Record<string, unknown>) {
    if (!(await run(() => api.put('/location/me/settings', body)))) return;
    // The family, and any trip estimate, shouldn't have to wait for the next beat.
    if (body.mode && body.mode !== 'paused') reportNow();
    onChanged();
  }

  async function end() {
    if (await run(() => stop())) {
      onChanged();
      onClose();
    }
  }

  const modeHint: Record<SharingMode, MessageKey> = { exact: 'locator.modeExactHint', blurred: 'locator.modeNearbyHint', paused: 'locator.modePausedHint' };
  const live = on ? mine.mode : mode;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(on ? 'locator.sharingTitleOn' : 'locator.sharingTitle')}
      subtitle={on && mine.shareUntil ? t('locator.endsAt', { time: timeOf(mine.shareUntil) }) : elsewhere ? t('locator.sharingElsewhere') : undefined}
      size="sm"
      footer={
        on ? (
          <button type="button" className="btn btn-danger" onClick={end} disabled={busy}>
            {t('locator.stop')}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={begin} disabled={busy}>{t('locator.startSharing')}</button>
          </>
        )
      }
    >
      <div className="stack">
        <div className="field">
          <span className="field-label-sm">{t('locator.whatTheySee')}</span>
          <Segmented<SharingMode>
            label={t('locator.whatTheySee')}
            value={live}
            onChange={(value) => (on ? change({ mode: value }) : setMode(value as 'exact' | 'blurred'))}
            options={[
              { value: 'exact', label: t('locator.modeExact') },
              { value: 'blurred', label: t('locator.modeNearby') },
              ...(on ? [{ value: 'paused' as const, label: t('locator.modePaused') }] : []),
            ]}
          />
          <p className="field-hint">{t(modeHint[live])}</p>
        </div>

        <div className="field">
          <span className="field-label-sm">{on ? t('locator.keepSharing') : t('locator.howLong')}</span>
          <Segmented<Duration>
            label={t('locator.howLong')}
            // A running timed share matches none of the three: it shows which one to restart it with.
            value={on ? (mine.shareUntil ? ('' as Duration) : 'always') : duration}
            onChange={(value) => (on ? change({ durationMinutes: DURATION_MINUTES(value) }) : setDuration(value))}
            options={durations}
          />
        </div>

        <Switch
          checked={recap}
          onChange={(value) => {
            setRecap(value);
            if (on) change({ recap: value });
          }}
          label={t('locator.recap')}
          hint={t('locator.recapHint')}
        />
        <p className="field-hint">{t('locator.alertsStillWork')}</p>
      </div>
    </Sheet>
  );
}

// ---- Places ----

type PlaceDraft = { id: string | null; name: string; kind: PlaceKind; note: string; radiusM: number; reward: string; point: Point | null };

const emptyPlace: PlaceDraft = { id: null, name: '', kind: 'home', note: '', radiusM: 150, reward: '', point: null };
const RADII = [75, 150, 250, 400, 700];
// Digits, one point, two decimals: what the API takes as an amount.
const moneyInput = (value: string) => value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2})\d+$/, '$1');

export function PlacesSheet({
  open,
  onClose,
  places,
  isAdmin,
  currency,
  onPick,
  onChanged,
  onShow,
}: {
  open: boolean;
  onClose: () => void;
  places: Place[];
  isAdmin: boolean;
  currency: string;
  onPick: RequestPick;
  onChanged: () => void;
  onShow: (point: Point) => void;
}) {
  const { confirm } = useUi();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<PlaceDraft | null>(null);

  async function save() {
    if (!draft || !draft.point || !draft.name.trim()) return;
    const body = {
      name: draft.name.trim(),
      kind: draft.kind,
      note: draft.note.trim() || null,
      radiusM: draft.radiusM,
      rewardAmount: Number(draft.reward) > 0 ? String(Number(draft.reward)) : null,
      ...draft.point,
    };
    const ok = await run(() => (draft.id ? api.patch(`/location/places/${draft.id}`, body) : api.post('/location/places', body)));
    if (ok) {
      setDraft(null);
      onChanged();
    }
  }

  async function remove(place: Place) {
    if (!(await confirm({ title: t('locator.deletePlace', { name: place.name }), body: t('locator.deletePlaceBody'), confirmLabel: t('common.delete'), danger: true }))) return;
    if (await run(() => api.delete(`/location/places/${place.id}`))) onChanged();
  }

  const set = <K extends keyof PlaceDraft>(key: K, value: PlaceDraft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <Sheet
      open={open}
      onClose={() => (draft ? setDraft(null) : onClose())}
      title={draft ? t(draft.id ? 'locator.editPlace' : 'locator.newPlace') : t('locator.places')}
      subtitle={draft ? undefined : t('locator.placesHint')}
      footer={
        draft ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !draft.point || !draft.name.trim()}>{t('common.save')}</button>
          </>
        ) : isAdmin ? (
          <button type="button" className="btn btn-primary" onClick={() => setDraft({ ...emptyPlace, kind: places.some((p) => p.kind === 'home') ? 'other' : 'home' })}>
            <Icon name="plus" size={18} /> {t('locator.addPlace')}
          </button>
        ) : undefined
      }
    >
      {draft ? (
        <div className="stack">
          <label className="field">
            <span className="field-label-sm">{t('locator.placeName')}</span>
            <input className="input" value={draft.name} maxLength={60} onChange={(e) => set('name', e.target.value)} placeholder={t('locator.placeNamePlaceholder')} data-autofocus />
          </label>
          <label className="field">
            <span className="field-label-sm">{t('locator.placeKind')}</span>
            <select className="input" value={draft.kind} onChange={(e) => set('kind', e.target.value as PlaceKind)}>
              {PLACE_KINDS.map((kind) => (
                <option key={kind} value={kind}>{`${KIND_EMOJI[kind]} ${t(`locator.kind.${kind}` as MessageKey)}`}</option>
              ))}
            </select>
            <span className="field-hint">{t(`locator.kindHint.${draft.kind}` as MessageKey)}</span>
          </label>
          <AddressSearch near={draft.point ?? places[0] ?? null} onFound={(point) => set('point', point)} />
          <PointField value={draft.point} radiusM={draft.radiusM} onChange={(point) => set('point', point)} onPick={onPick} />
          <label className="field">
            <span className="field-label-sm">{t('locator.radius')}</span>
            <select className="input" value={draft.radiusM} onChange={(e) => set('radiusM', Number(e.target.value))}>
              {[...new Set([...RADII, draft.radiusM])].sort((a, b) => a - b).map((r) => (
                <option key={r} value={r}>{distanceText(r)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label-sm">{t('locator.placeNote')}</span>
            <input className="input" value={draft.note} maxLength={200} onChange={(e) => set('note', e.target.value)} placeholder={t('locator.placeNotePlaceholder')} />
          </label>
          <div className="field">
            <span className="field-label-sm">{t('locator.placeReward')}</span>
            <div className="money-input">
              <span>{currencySymbol(currency)}</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="0"
                value={draft.reward}
                onChange={(e) => set('reward', moneyInput(e.target.value))}
                aria-label={t('locator.placeReward')}
              />
            </div>
            <span className="field-hint">{t('locator.placeRewardHint')}</span>
          </div>
        </div>
      ) : places.length === 0 ? (
        <p className="muted">{t(isAdmin ? 'locator.noPlacesParent' : 'locator.noPlaces')}</p>
      ) : (
        <ul className="sheet-list">
          {places.map((place) => (
            <li key={place.id} className="sheet-list-item">
              <button type="button" className="sheet-list-main" onClick={() => { onShow(place); onClose(); }}>
                <span className="sheet-list-emoji">{KIND_EMOJI[place.kind]}</span>
                <span className="sheet-list-text">
                  <span className="sheet-list-title">{place.name}</span>
                  <span className="field-hint">
                    {[distanceText(place.radiusM), place.rewardAmount ? `⭐ ${currencySymbol(currency)}${place.rewardAmount}` : null, place.note].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
              {isAdmin && (
                <span className="sheet-list-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('common.edit')}
                    onClick={() =>
                      setDraft({ id: place.id, name: place.name, kind: place.kind, note: place.note ?? '', radiusM: place.radiusM, reward: place.rewardAmount ?? '', point: { lat: place.lat, lng: place.lng } })
                    }
                  >
                    <Icon name="edit" size={18} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={t('common.delete')} onClick={() => remove(place)}>
                    <Icon name="trash" size={18} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ---- Errands: a task pinned to the map ----

export function ErrandsSheet({
  open,
  onClose,
  errands,
  people,
  me,
  onPick,
  onChanged,
  onShow,
}: {
  open: boolean;
  onClose: () => void;
  errands: Errand[];
  people: Member[];
  me: Member;
  onPick: RequestPick;
  onChanged: () => void;
  onShow: (point: Point) => void;
}) {
  const { confirm } = useUi();
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [point, setPoint] = useState<Point | null>(null);
  const nameOf = (id: string) => firstName(people.find((p) => p.id === id)?.displayName ?? '');

  async function add() {
    if (!point || !title.trim()) return;
    const ok = await run(() => api.post('/location/errands', { title: title.trim(), note: note.trim() || null, ...point }), t('locator.errandAdded'));
    if (ok) {
      setAdding(false);
      setTitle('');
      setNote('');
      setPoint(null);
      onChanged();
    }
  }

  const act = async (path: string, method: 'post' | 'delete' = 'post') => {
    if (await run(() => api[method](path))) onChanged();
  };

  async function remove(errand: Errand) {
    if (await confirm({ title: t('locator.deleteErrand', { name: errand.title }), confirmLabel: t('common.delete'), danger: true })) act(`/location/errands/${errand.id}`, 'delete');
  }

  // Yours first, then what nobody has taken, then what someone else is on.
  const rank = (errand: Errand) => (errand.claimedById === me.id ? 0 : errand.claimedById ? 2 : 1);
  const sorted = [...errands].sort((a, b) => rank(a) - rank(b));

  return (
    <Sheet
      open={open}
      onClose={() => (adding ? setAdding(false) : onClose())}
      title={adding ? t('locator.newErrand') : t('locator.errands')}
      subtitle={adding ? undefined : t('locator.errandsHint')}
      footer={
        adding ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={add} disabled={busy || !point || !title.trim()}>{t('common.add')}</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} /> {t('locator.addErrand')}
          </button>
        )
      }
    >
      {adding ? (
        <div className="stack">
          <label className="field">
            <span className="field-label-sm">{t('locator.errandTitle')}</span>
            <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={t('locator.errandPlaceholder')} data-autofocus />
          </label>
          <label className="field">
            <span className="field-label-sm">{t('locator.placeNote')}</span>
            <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </label>
          <PointField value={point} onChange={setPoint} onPick={onPick} />
        </div>
      ) : errands.length === 0 ? (
        <p className="muted">{t('locator.noErrands')}</p>
      ) : (
        <ul className="sheet-list">
          {sorted.map((errand) => {
            const mineErrand = errand.claimedById === me.id;
            const claim = mineErrand
              ? t('locator.takenByYou')
              : errand.claimedById
                ? t('locator.takenBy', { name: nameOf(errand.claimedById) })
                : errand.closest?.userId === me.id
                  ? t('locator.closestYou', { distance: distanceText(errand.closest.distanceM) })
                  : errand.closest
                    ? t('locator.closestIs', { name: nameOf(errand.closest.userId), distance: distanceText(errand.closest.distanceM) })
                    : t('locator.nobodyTook');
            const details = [errand.note, errand.createdById === me.id ? null : t('locator.askedBy', { name: nameOf(errand.createdById) })].filter(Boolean).join(' · ');
            return (
              <li key={errand.id} className="sheet-list-item is-column">
                <button type="button" className="sheet-list-main" onClick={() => { onShow(errand); onClose(); }}>
                  <span className="sheet-list-emoji">🛒</span>
                  <span className="sheet-list-text">
                    <span className="sheet-list-title">{errand.title}</span>
                    <span className="field-hint">{claim}</span>
                    {details && <span className="field-hint">{details}</span>}
                  </span>
                </button>
                <span className="row-gap">
                  {!errand.claimedById && (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(`/location/errands/${errand.id}/claim`)}>
                      {t('locator.claimIt')}
                    </button>
                  )}
                  {errand.claimedById && (mineErrand || me.isAdmin) && (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(`/location/errands/${errand.id}/release`)}>
                      {t('locator.release')}
                    </button>
                  )}
                  {(!errand.claimedById || mineErrand || me.isAdmin) && (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(`/location/errands/${errand.id}/done`)}>
                      <Icon name="check" size={16} /> {t('locator.errandDone')}
                    </button>
                  )}
                  {(errand.createdById === me.id || me.isAdmin) && (
                    <button type="button" className="icon-btn" aria-label={t('common.delete')} disabled={busy} onClick={() => remove(errand)}>
                      <Icon name="trash" size={18} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

// ---- Things: the dog, the bike, the car ----

export function TagsSheet({
  open,
  onClose,
  tags,
  people,
  onPick,
  onChanged,
  onShow,
}: {
  open: boolean;
  onClose: () => void;
  tags: MapTag[];
  people: Member[];
  onPick: RequestPick;
  onChanged: () => void;
  onShow: (point: Point) => void;
}) {
  const { confirm } = useUi();
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(TAG_EMOJIS[0]);
  const [point, setPoint] = useState<Point | null>(null);

  async function add() {
    if (!point || !name.trim()) return;
    const ok = await run(() => api.post('/location/tags', { name: name.trim(), emoji, ...point }));
    if (ok) {
      setAdding(false);
      setName('');
      setPoint(null);
      onChanged();
    }
  }

  function moveTo(tag: MapTag, next: Point) {
    run(() => api.patch(`/location/tags/${tag.id}`, next), t('locator.thingMoved')).then((ok) => ok && onChanged());
  }

  function moveHere(tag: MapTag) {
    run(async () => api.patch(`/location/tags/${tag.id}`, await currentPosition()), t('locator.thingMoved')).then((ok) => ok && onChanged());
  }

  function moved(tag: MapTag) {
    const by = people.find((p) => p.id === tag.updatedById);
    return by ? t('locator.thingMovedBy', { name: firstName(by.displayName), when: relativeTime(tag.updatedAt) }) : relativeTime(tag.updatedAt);
  }

  async function remove(tag: MapTag) {
    if (!(await confirm({ title: t('locator.deleteThing', { name: tag.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    if (await run(() => api.delete(`/location/tags/${tag.id}`))) onChanged();
  }

  return (
    <Sheet
      open={open}
      onClose={() => (adding ? setAdding(false) : onClose())}
      title={adding ? t('locator.newThing') : t('locator.things')}
      subtitle={adding ? undefined : t('locator.thingsHint')}
      footer={
        adding ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={add} disabled={busy || !point || !name.trim()}>{t('common.add')}</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} /> {t('locator.addThing')}
          </button>
        )
      }
    >
      {adding ? (
        <div className="stack">
          <div className="field">
            <span className="field-label-sm">{t('locator.thingIcon')}</span>
            <div className="emoji-grid" role="radiogroup" aria-label={t('locator.thingIcon')}>
              {TAG_EMOJIS.map((e) => (
                <button key={e} type="button" role="radio" aria-checked={emoji === e} className={emoji === e ? 'is-active' : ''} onClick={() => setEmoji(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="field-label-sm">{t('locator.thingName')}</span>
            <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t('locator.thingPlaceholder')} data-autofocus />
          </label>
          <PointField value={point} onChange={setPoint} onPick={onPick} />
        </div>
      ) : tags.length === 0 ? (
        <p className="muted">{t('locator.noThings')}</p>
      ) : (
        <ul className="sheet-list">
          {tags.map((tag) => (
            <li key={tag.id} className="sheet-list-item is-column">
              <button type="button" className="sheet-list-main" onClick={() => { onShow(tag); onClose(); }}>
                <span className="sheet-list-emoji">{tag.emoji}</span>
                <span className="sheet-list-text">
                  <span className="sheet-list-title">{tag.name}</span>
                  <span className="field-hint">{moved(tag)}</span>
                </span>
              </button>
              <span className="row-gap">
                {'geolocation' in navigator && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => moveHere(tag)}>
                    {t('locator.moveHere')}
                  </button>
                )}
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onPick((point) => moveTo(tag, point), { start: tag })}>
                  {t('locator.moveOnMap')}
                </button>
                <button type="button" className="icon-btn" aria-label={t('common.delete')} disabled={busy} onClick={() => remove(tag)}>
                  <Icon name="trash" size={18} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ---- Stickers ----

const POKE_LABEL: Record<(typeof POKE_KINDS)[number], { emoji: string; label: MessageKey }> = {
  wave: { emoji: '👋', label: 'locator.poke.wave' },
  comeHome: { emoji: '🏠', label: 'locator.poke.comeHome' },
  dinner: { emoji: '🍽️', label: 'locator.poke.dinner' },
  onMyWay: { emoji: '🚗', label: 'locator.poke.onMyWay' },
  thinking: { emoji: '💛', label: 'locator.poke.thinking' },
};

// Tapping someone: where they are, what to do about it, and a sticker.
export function PersonSheet({
  person,
  status,
  chips,
  distance,
  directions,
  onShow,
  onClose,
}: {
  person: Member | null;
  status: string;
  chips: ReactNode;
  distance: string | null;
  directions: string | null;
  onShow: (() => void) | null;
  onClose: () => void;
}) {
  const { busy, run } = useAction();
  if (!person) return null;
  const name = firstName(person.displayName);
  const send = async (kind: (typeof POKE_KINDS)[number]) => {
    if (await run(() => api.post('/location/poke', { userId: person.id, kind }), t('locator.poked', { name }))) onClose();
  };
  return (
    <Sheet open onClose={onClose} title={person.displayName} subtitle={status} size="sm">
      <div className="stack">
        {(chips || distance) && (
          <div className="person-facts">
            {chips}
            {distance && <span className="field-hint">{t('locator.fromYou', { distance })}</span>}
          </div>
        )}
        {(onShow || directions) && (
          <div className="row-gap">
            {onShow && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onShow}>
                <Icon name="pin" size={16} /> {t('locator.showOnMap')}
              </button>
            )}
            {directions && (
              <a className="btn btn-secondary btn-sm" href={directions} target="_blank" rel="noreferrer">
                🧭 {t('locator.directions')}
              </a>
            )}
          </div>
        )}
        <div className="field">
          <span className="field-label-sm">{t('locator.pokeTitle', { name })}</span>
          <div className="poke-grid">
            {POKE_KINDS.map((kind) => (
              <button key={kind} type="button" className="poke" disabled={busy} onClick={() => send(kind)}>
                <span className="poke-emoji">{POKE_LABEL[kind].emoji}</span>
                <span>{t(POKE_LABEL[kind].label)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ---- Heading somewhere ----

export function TripSheet({
  open,
  onClose,
  places,
  herePlaceId,
  heading,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  places: Place[];
  /** Where the viewer is already: nobody heads to where they stand. */
  herePlaceId: string | null;
  heading: { place: string; minutes: number } | null;
  onChanged: () => void;
}) {
  const { busy, run } = useAction();
  const [mode, setMode] = useState<'walk' | 'drive'>('walk');
  const options = places.filter((place) => place.id !== herePlaceId);

  const go = async (place: Place) => {
    if (await run(() => api.post('/location/me/trip', { placeId: place.id, mode }), t('locator.tripStarted', { place: place.name }))) {
      onChanged();
      onClose();
    }
  };
  const cancel = async () => {
    if (await run(() => api.delete('/location/me/trip'))) {
      onChanged();
      onClose();
    }
  };

  let body: ReactNode;
  if (options.length === 0) body = <p className="muted">{t(places.length === 0 ? 'locator.noPlaces' : 'locator.noOtherPlaces')}</p>;
  else
    body = (
      <div className="stack">
        <Segmented<'walk' | 'drive'>
          label={t('locator.tripHow')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'walk', label: `🚶 ${t('locator.walking')}` },
            { value: 'drive', label: `🚗 ${t('locator.driving')}` },
          ]}
        />
        <ul className="sheet-list">
          {options.map((place) => (
            <li key={place.id} className="sheet-list-item">
              <button type="button" className="sheet-list-main" disabled={busy} onClick={() => go(place)}>
                <span className="sheet-list-emoji">{KIND_EMOJI[place.kind]}</span>
                <span className="sheet-list-text">
                  <span className="sheet-list-title">{place.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('locator.headingTo')}
      subtitle={heading ? t('locator.etaBubble', { place: heading.place, time: minutesText(heading.minutes) }) : t('locator.headingHint')}
      size="sm"
      footer={
        heading ? (
          <button type="button" className="btn btn-secondary" onClick={cancel} disabled={busy}>
            {t('locator.cancelTrip')}
          </button>
        ) : undefined
      }
    >
      {body}
    </Sheet>
  );
}
