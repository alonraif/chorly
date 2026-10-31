import { DRIVING_MPS, MOVING_MPS, TOGETHER_M, distanceM } from '@chorly/shared';
import { now } from './format';
import { t, type MessageKey } from './i18n';

export type PlaceKind = 'home' | 'school' | 'work' | 'fun' | 'store' | 'other';
export type SharingMode = 'exact' | 'blurred' | 'paused';

export type Place = {
  id: string;
  name: string;
  kind: PlaceKind;
  note: string | null;
  lat: number;
  lng: number;
  radiusM: number;
  rewardAmount: string | null;
};

export type PersonLocation = {
  userId: string;
  mode: SharingMode;
  shareUntil: string | null;
  updatedAt: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  battery: number | null;
  charging: boolean | null;
  speed: number | null;
  placeId: string | null;
  placeSince: string | null;
  trip: { placeId: string; mode: 'walk' | 'drive'; etaAt: string | null } | null;
  blurRadiusM: number | null;
};

export type Errand = {
  id: string;
  title: string;
  note: string | null;
  lat: number;
  lng: number;
  createdById: string;
  claimedById: string | null;
  createdAt: string;
  closest: { userId: string; distanceM: number } | null;
};

export type MapTag = { id: string; name: string; emoji: string; lat: number; lng: number; updatedById: string | null; updatedAt: string };

export type Overview = {
  locations: PersonLocation[];
  places: Place[];
  errands: Errand[];
  tags: MapTag[];
  mine: { mode: SharingMode; shareUntil: string | null; recap: boolean };
};

export const KIND_EMOJI: Record<PlaceKind, string> = { home: '🏠', school: '🎒', work: '💼', fun: '🎈', store: '🛒', other: '📍' };
export const KIND_COLOR: Record<PlaceKind, string> = { home: '#2b8a3e', school: '#1c7ed6', work: '#7048e8', fun: '#e8590c', store: '#c2255c', other: '#868e96' };
export const PLACE_KINDS: PlaceKind[] = ['home', 'school', 'work', 'fun', 'store', 'other'];
export const TAG_EMOJIS = ['🐕', '🐈', '🚲', '🚗', '🔑', '🎒', '🧸', '📦'];

// Past this, the person is shown faded: it's where they were, not where they are.
export const STALE_MS = 10 * 60_000;
const LOW_BATTERY = 15;

export function isStale(location: PersonLocation) {
  return Date.now() - new Date(location.updatedAt).getTime() > STALE_MS;
}

export function minutesText(minutes: number) {
  if (minutes < 60) return t('locator.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest >= 10 ? t('locator.hoursMinutes', { hours, minutes: rest }) : t('locator.hours', { count: hours });
}

export function distanceText(meters: number) {
  return meters < 1000 ? t('locator.meters', { count: Math.round(meters / 5) * 5 }) : t('locator.km', { count: (meters / 1000).toFixed(1) });
}

// "Just now" and the like for the age of a fix come from the page; this is for how long someone has stayed put.
export function stayText(since: string) {
  return minutesText(Math.max(1, Math.round((Date.now() - new Date(since).getTime()) / 60_000)));
}

export function tripMinutes(location: PersonLocation) {
  // An estimate from a phone that stopped reporting would count down to nothing.
  if (!location.trip?.etaAt || isStale(location)) return null;
  return Math.max(1, Math.ceil((new Date(location.trip.etaAt).getTime() - Date.now()) / 60_000));
}

// One cartoon-style bubble for what the person is up to, worked out from where they are and how fast they move.
export function pulseOf(location: PersonLocation, place: Place | undefined): { emoji: string; label: string } {
  if (location.mode === 'paused') return { emoji: '🔒', label: t('pulse.paused') };
  // How fast someone was going an hour ago says nothing about now.
  const stale = isStale(location);
  const speed = stale ? 0 : (location.speed ?? 0);
  if (speed >= DRIVING_MPS) return { emoji: '🚗', label: t('pulse.driving') };
  if (speed >= MOVING_MPS) return { emoji: '🚶', label: t('pulse.walking') };
  if (place) {
    const hour = now().hour;
    const labels: Record<PlaceKind, MessageKey> = {
      home: 'pulse.home',
      school: 'pulse.school',
      work: 'pulse.work',
      fun: 'pulse.fun',
      store: 'pulse.store',
      other: 'pulse.atPlace',
    };
    if (place.kind === 'home' && !stale && (hour >= 22 || hour < 6)) return { emoji: '😴', label: t('pulse.sleeping') };
    return { emoji: KIND_EMOJI[place.kind], label: t(labels[place.kind], { place: place.name }) };
  }
  return stale ? { emoji: '🕓', label: t('pulse.lastSeen') } : { emoji: '📍', label: t('pulse.out') };
}

export function batteryChip(location: PersonLocation) {
  if (location.battery === null || location.mode === 'paused' || isStale(location)) return null;
  const low = location.battery <= LOW_BATTERY && !location.charging;
  return { text: `${location.charging ? '⚡' : low ? '🪫' : '🔋'} ${location.battery}%`, low };
}

// People standing within a few metres of each other, as groups of ids.
export function togetherGroups(locations: PersonLocation[]) {
  const live = locations.filter((l) => l.mode === 'exact' && l.lat !== null && l.lng !== null && !isStale(l));
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const a of live) {
    if (seen.has(a.userId)) continue;
    const group = live.filter((b) => b === a || distanceM({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! }) <= TOGETHER_M);
    if (group.length < 2) continue;
    group.forEach((g) => seen.add(g.userId));
    // Everyone at home is what the list already says; it's meeting up elsewhere that's news.
    if (a.placeId && group.every((g) => g.placeId === a.placeId)) continue;
    groups.push(group.map((g) => g.userId));
  }
  return groups;
}

export function directionsUrl(point: { lat: number; lng: number }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`;
}

// A place-bound chore refused the tap: why, in the member's language. Null for any other failure.
export function placeBlockedText(err: unknown, place: { name: string } | null | undefined) {
  const blocked = err instanceof Error ? /^place_required:(at_place|visited)$/.exec(err.message) : null;
  if (!blocked || !place) return null;
  return t(blocked[1] === 'visited' ? 'instance.placeBlockedVisited' : 'instance.placeBlockedAt', { place: place.name });
}

// Minutes from now until the end of the local day, for "until tonight".
export function minutesUntilTonight() {
  const current = now();
  return Math.max(1, Math.ceil(current.endOf('day').diff(current, 'minutes').minutes));
}
