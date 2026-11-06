'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker, Point as ScreenPoint } from 'maplibre-gl';
import { TOGETHER_M, distanceM } from '@chorly/shared';
import { firstName } from '../lib/format';
import { getLocale, listJoin, t } from '../lib/i18n';
import { KIND_COLOR, KIND_EMOJI, type PlaceKind } from '../lib/places';
import { hueFor, initials } from './avatar';
import { Icon } from './icon';

export type MapPerson = {
  id: string;
  displayName: string;
  avatarAt: string | null;
  lat: number;
  lng: number;
  stale: boolean;
  /** The cartoon bubble for what they're up to. */
  emoji: string;
  /** "Home in 12 min", shown under the name. */
  eta: string | null;
  /** "54 km/h" while they're on the move, shown next to the name. */
  speedText: string | null;
  /** Degrees clockwise from north while moving: an arrow on the avatar points the way. */
  heading: number | null;
  /** Set when they share only their neighbourhood: the map draws a halo this big instead of a sharp position. */
  blurRadiusM: number | null;
};
export type MapPlace = { id: string; name: string; kind: PlaceKind; lat: number; lng: number; radiusM: number };
export type MapErrand = { id: string; title: string; lat: number; lng: number; claimed: boolean };
export type MapThing = { id: string; name: string; emoji: string; lat: number; lng: number };
/** Where someone went, oldest first, drawn in their colour. */
export type MapTrail = { key: string; hue: number; points: { lat: number; lng: number }[] };
/** Where to fly. `lift` keeps the spot in the top part of the map, clear of a card over the bottom. */
export type MapFocus = { key: number; lat: number; lng: number; zoom?: number; lift?: boolean };

type Point = { lat: number; lng: number };
/** Choosing a spot: where the pin is so far, and the area a place would cover around it. */
export type MapPick = { point: Point | null; radiusM?: number };

const DARK_QUERY = '(prefers-color-scheme: dark)';
const CALM_QUERY = '(prefers-reduced-motion: reduce)';
const SHAPES = 'family-shapes';
const TRAIL = 'family-trail';
const PICK_COLOR = '#1c7ed6';
// Where a family with nothing on the map yet starts: zoomed in enough to find a street, unlike the whole globe.
const START_VIEW = { center: [34.85, 31.7] as [number, number], zoom: 6.5 };
// Things that would collide on screen merge into one bubble; a tap on it zooms in until it splits.
// Two things in a bubble stay in it until they're a little further apart than what joined them,
// so a pinch that hovers on the edge doesn't split and merge them over and over.
const GROUP_PX = 64;
const SPLIT_PX = 84;
// Places, errands and things never share a bubble with people, and stop merging at street level.
const BREAK_ZOOM = 15;
// People this close to the middle of their bubble are together at one spot. Their bubble says who
// they are, and a tap asks which of them to look at: zooming in wouldn't part them in any useful way.
// (Spreading them out side by side made people at home look as if they were across the neighbourhood.)
const TOGETHER_RADIUS_M = TOGETHER_M;
// How far a tap on a bubble may zoom in to split it.
const MAX_SPLIT_ZOOM = 18;
const TOGETHER_NAMES = 3;
const GROUP_FACES = 3;
const GROUP_EMOJIS = 3;
const PICK_ZOOM = 15;
// Someone tapped in the list or on the map comes up at least this close.
export const PERSON_ZOOM = 16;
// They line up side by side, rows at most this long, so that every name tag stays readable.
// How long a marker takes to slide into a bubble or back out of it.
const GLIDE_MS = 280;
const GLIDE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
// Room for name tags under a marker and place tags above one.
const FRAME_PADDING = { top: 72, bottom: 88, left: 80, right: 80 };

function styleUrl(dark: boolean) {
  return `https://tiles.openfreemap.org/styles/${dark ? 'fiord' : 'positron'}`;
}

// The styles print each place in two languages. Show only the app's, or the local name if it has none.
function labelInAppLanguage(map: MapLibreMap) {
  const name = ['coalesce', ['get', `name:${getLocale()}`], ['get', 'name']];
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'symbol' && map.getLayoutProperty(layer.id, 'text-field')) {
      map.setLayoutProperty(layer.id, 'text-field', name);
    }
  }
}

// A circle of `radiusM` metres as a polygon: map layers draw in pixels, a place's radius is in metres.
function circle(center: Point, radiusM: number, properties: Record<string, string>) {
  const steps = 48;
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const ring = Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI;
    return [center.lng + dLng * Math.cos(angle), center.lat + dLat * Math.sin(angle)];
  });
  return { type: 'Feature' as const, properties, geometry: { type: 'Polygon' as const, coordinates: [ring] } };
}

function shapesOf(people: MapPerson[], places: MapPlace[], pick: MapPick | null) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...places.map((p) => circle(p, p.radiusM, { color: KIND_COLOR[p.kind], halo: '0' })),
      ...people.filter((p) => p.blurRadiusM).map((p) => circle(p, p.blurRadiusM!, { color: '#495057', halo: '1' })),
      ...(pick?.point && pick.radiusM ? [circle(pick.point, pick.radiusM, { color: PICK_COLOR, halo: '0' })] : []),
    ],
  };
}

function addShapes(map: MapLibreMap, data: ReturnType<typeof shapesOf>) {
  if (map.getSource(SHAPES)) return;
  map.addSource(SHAPES, { type: 'geojson', data });
  map.addLayer({ id: `${SHAPES}-fill`, type: 'fill', source: SHAPES, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'halo'], '1'], 0.12, 0.16] } });
  map.addLayer({
    id: `${SHAPES}-line`,
    type: 'line',
    source: SHAPES,
    paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [2, 2] },
  });
}

function trailData(trail: MapTrail | null) {
  const coordinates = (trail?.points ?? []).map((p) => [p.lng, p.lat]);
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: coordinates.length >= 2 ? coordinates : [] },
  };
}

// Faint where it began, strong where they are now: which way they went reads at a glance.
const trailGradient = (hue: number) => ['interpolate', ['linear'], ['line-progress'], 0, `hsla(${hue}, 70%, 50%, 0.15)`, 1, `hsla(${hue}, 70%, 50%, 0.95)`];

function addTrail(map: MapLibreMap, trail: MapTrail | null) {
  if (map.getSource(TRAIL)) return;
  // Line metrics: the gradient runs along the line.
  map.addSource(TRAIL, { type: 'geojson', data: trailData(trail), lineMetrics: true });
  map.addLayer({
    id: `${TRAIL}-line`,
    type: 'line',
    source: TRAIL,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 5, 'line-gradient': trailGradient(trail?.hue ?? 210) as any },
  });
}

function span(className: string, text?: string) {
  const el = document.createElement('span');
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Markers are plain elements, so they get what a button would have for free.
function tappable<T extends HTMLElement>(root: T, label: string, onClick: () => void) {
  root.setAttribute('role', 'button');
  root.setAttribute('aria-label', label);
  root.tabIndex = 0;
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onClick();
  });
  return root;
}

// Everything below is built as elements, not HTML strings, so names can't inject markup into the map.
function faceElement(person: Pick<MapPerson, 'id' | 'displayName' | 'avatarAt'>) {
  const face = span('avatar');
  face.style.setProperty('--hue', String(hueFor(person.id)));
  face.textContent = initials(person.displayName);
  if (person.avatarAt) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `/api/users/${person.id}/avatar?v=${encodeURIComponent(person.avatarAt)}`;
    img.onload = () => face.replaceChildren(img);
  }
  return face;
}

function personElement(person: MapPerson, onClick: () => void) {
  const root = tappable(document.createElement('div'), person.displayName, onClick);
  root.className = `map-person ${person.stale ? 'is-stale' : ''}`;

  const label = span('map-person-name');
  // The map itself stays left-to-right; a name with "54 קמ״ש" after it reads in the app's direction.
  label.dir = document.documentElement.dir || 'auto';
  label.append(span('map-person-first', firstName(person.displayName)), span('map-person-speed'));
  root.append(span('map-person-heading'), faceElement(person), span('map-person-pulse', person.emoji), label);
  if (person.eta) root.append(span('map-person-eta', person.eta));
  movePerson(root, person);
  return root;
}

// Speed and heading change with every report while someone moves: they're updated in place, not rebuilt.
function movePerson(root: HTMLElement, person: MapPerson) {
  const speed = root.querySelector<HTMLElement>('.map-person-speed');
  if (speed) speed.textContent = person.speedText ?? '';
  root.classList.toggle('is-moving', !!person.speedText);
  root.classList.toggle('has-heading', person.heading !== null);
  if (person.heading !== null) root.style.setProperty('--heading', `${Math.round(person.heading)}deg`);
  root.setAttribute('aria-label', person.speedText ? `${person.displayName}, ${person.speedText}` : person.displayName);
}

function placeElement(place: MapPlace, onClick: () => void) {
  const root = tappable(span('map-place'), place.name, onClick);
  root.append(span('map-place-emoji', KIND_EMOJI[place.kind]), span('map-place-name', place.name));
  return root;
}

function errandElement(errand: MapErrand, onClick: () => void) {
  const root = tappable(span(`map-errand ${errand.claimed ? 'is-claimed' : ''}`), errand.title, onClick);
  root.append(span('map-errand-pin', '🛒'), span('map-errand-title', errand.title));
  return root;
}

function thingElement(thing: MapThing, onClick: () => void) {
  const root = tappable(span('map-thing'), thing.name, onClick);
  root.append(span('map-thing-emoji', thing.emoji), span('map-thing-name', thing.name));
  return root;
}

type MarkerStore = Map<string, { marker: Marker; look: string }>;
type MarkerItem = {
  id: string;
  lat: number;
  lng: number;
  look: string;
  make: () => HTMLElement;
  /** What changes too often to rebuild the marker for. */
  update?: (element: HTMLElement) => void;
  anchor?: 'center' | 'bottom';
};

// Keeps one marker per item: moved when the item moves, rebuilt only when how it looks changes.
function syncMarkers(
  maplibre: typeof import('maplibre-gl'),
  map: MapLibreMap,
  store: MarkerStore,
  items: MarkerItem[],
  // Takes over a marker that's no longer needed, for one that shouldn't just vanish.
  retire: (id: string, marker: Marker) => void = (_, marker) => marker.remove(),
) {
  const seen = new Set<string>();
  let added = false;
  for (const item of items) {
    seen.add(item.id);
    const existing = store.get(item.id);
    if (existing && existing.look === item.look) {
      existing.marker.setLngLat([item.lng, item.lat]);
      item.update?.(existing.marker.getElement());
      continue;
    }
    existing?.marker.remove();
    added ||= !existing;
    const element = item.make();
    const label = element.getAttribute('aria-label');
    const marker = new maplibre.Marker({ element, anchor: item.anchor ?? 'center' }).setLngLat([item.lng, item.lat]).addTo(map);
    // Adding a marker replaces its label with a generic "Map marker".
    if (label) element.setAttribute('aria-label', label);
    store.set(item.id, { marker, look: item.look });
  }
  store.forEach(({ marker }, id) => {
    if (seen.has(id)) return;
    retire(id, marker);
    store.delete(id);
  });
  return added;
}

type StoreName = 'people' | 'places' | 'errands' | 'things';
// `shownAs` remembers what each thing was last drawn as: its own marker, or the bubble holding it.
// `cluster` remembers which bubble or side-by-side row it was part of, so that it can stay there.
type Stores = Record<StoreName, MarkerStore> & {
  groups: Map<string, Marker>;
  groupItems: Map<string, Cluster>;
  shownAs: Map<string, string>;
  cluster: Map<string, string>;
  seq: number;
};
// One thing on the map, as the grouping sees it: a person has a face, anything else an emoji.
type Placed = { store: StoreName; id: string; lat: number; lng: number; label: string; person?: MapPerson; emoji?: string };
type Cluster = { id: string; items: Placed[]; together: boolean };

const keyOf = (item: Placed) => `${item.store}:${item.id}`;
const pixels = (x: number, y: number) => `${x}px ${y}px`;
const HOME = { translate: pixels(0, 0), opacity: 1 };

const flights = new WeakMap<HTMLElement, Animation>();

// Slides a marker with `translate`, which adds to the `transform` MapLibre places it with, so it keeps following the map.
function glide(element: HTMLElement, from: Keyframe, to: Keyframe, done?: () => void) {
  const flight = flights.get(element);
  if (flight) {
    // Turned around halfway: it carries on from where it got to.
    const { translate, opacity } = getComputedStyle(element);
    from = { translate, opacity };
    flight.cancel();
    flights.delete(element);
  }
  if (window.matchMedia(CALM_QUERY).matches) {
    done?.();
    return;
  }
  const next = element.animate([from, to], { duration: GLIDE_MS, easing: GLIDE_EASING, fill: 'forwards' });
  flights.set(element, next);
  next.onfinish = () => {
    flights.delete(element);
    done?.();
    next.cancel();
  };
}

// Where a marker is drawn. Pixels, so only good for right now: the next frame of a zoom moves it.
const screenAt = (map: MapLibreMap, marker: Marker) => map.project(marker.getLngLat()).add(marker.getOffset());

type OnScreen = { item: Placed; at: ScreenPoint };

// The longest link needed to hold a group together (its spanning tree's longest edge): the group
// first splits when that link grows past SPLIT_PX, which says how far to zoom to see it split.
function widestLink(points: OnScreen[]) {
  if (points.length < 2) return 0;
  const inTree = new Set([points[0]]);
  let widest = 0;
  while (inTree.size < points.length) {
    let best: { point: OnScreen; d: number } | null = null;
    for (const a of inTree) {
      for (const b of points) {
        if (inTree.has(b)) continue;
        const d = a.at.dist(b.at);
        if (!best || d < best.d) best = { point: b, d };
      }
    }
    inTree.add(best!.point);
    widest = Math.max(widest, best!.d);
  }
  return widest;
}

// The zoom at which a group at `zoom` first splits.
const splitZoom = (zoom: number, points: OnScreen[]) => zoom + Math.log2(SPLIT_PX / Math.max(widestLink(points), 0.01));

// Groups of things close enough on screen to collide, including through a neighbour.
function linked(points: OnScreen[], wereTogether: (a: Placed, b: Placed) => boolean) {
  const left = new Set(points);
  const groups: OnScreen[][] = [];
  for (const start of points) {
    if (!left.delete(start)) continue;
    const group = [start];
    for (const member of group) {
      for (const other of [...left]) {
        const reach = wereTogether(member.item, other.item) ? SPLIT_PX : GROUP_PX;
        if (member.at.dist(other.at) >= reach) continue;
        left.delete(other);
        group.push(other);
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

// Gives each group the id of the earlier one it mostly is, so a bubble that gains or loses someone
// is the same bubble changing, not one vanishing and another appearing.
function keepIds(stores: Stores, groups: Placed[][], kind: 'b' | 'f', taken: Set<string>) {
  return groups.map((items) => {
    const votes = new Map<string, number>();
    for (const item of items) {
      const was = stores.cluster.get(keyOf(item));
      if (was?.startsWith(kind) && !taken.has(was)) votes.set(was, (votes.get(was) ?? 0) + 1);
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const id = best ?? `${kind}${++stores.seq}`;
    taken.add(id);
    return id;
  });
}

function clustersOf(map: MapLibreMap, stores: Stores, items: Placed[]): Cluster[] {
  const zoom = map.getZoom();
  const wereTogether = (a: Placed, b: Placed) => {
    const was = stores.cluster.get(keyOf(a));
    return !!was && was === stores.cluster.get(keyOf(b));
  };
  const onScreen = (list: Placed[]) => list.map((item) => ({ item, at: map.project([item.lng, item.lat]) }));

  // People merge only with people, so nobody disappears into a bubble of shop pins.
  const bubbles = linked(onScreen(items.filter((item) => item.person)), wereTogether).map((group) => group.map((point) => point.item));
  // The rest stops merging at street level, where there's room for every tag.
  if (zoom < BREAK_ZOOM) {
    for (const group of linked(onScreen(items.filter((item) => !item.person)), wereTogether)) bubbles.push(group.map((point) => point.item));
  }
  const ids = keepIds(stores, bubbles, 'b', new Set());
  return bubbles.map((group, index) => ({ id: ids[index], items: group, together: isTogether(group) }));
}

// Everyone within a few dozen metres of the bubble's middle: the same house, the same school yard.
function isTogether(group: Placed[]) {
  if (!group.every((item) => item.person)) return false;
  const [lng, lat] = centerOf(group);
  return group.every((item) => distanceM(item, { lat, lng }) <= TOGETHER_RADIUS_M);
}

function fillGroup(root: HTMLElement, items: Placed[], together: boolean) {
  // The same order every time, so the faces don't shuffle as the bubble changes.
  const group = [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  // Called on every frame of a zoom: rebuilt only when who's in it changes, or faces would reload and pop.
  const look = `${together}:${group.map((item) => `${keyOf(item)}|${item.label}|${item.person?.avatarAt}|${item.emoji}`).join()}`;
  if (root.dataset.look === look) return;
  root.dataset.look = look;
  const faces = group.flatMap((item) => (item.person ? [item.person] : []));
  const emojis = group.flatMap((item) => (item.emoji ? [item.emoji] : []));
  const shownFaces = faces.slice(0, GROUP_FACES);
  const shownEmojis = emojis.slice(0, GROUP_EMOJIS);
  root.classList.toggle('is-people', faces.length > 0);
  root.classList.toggle('is-things', faces.length === 0);
  root.classList.toggle('is-together', together);
  root.replaceChildren(...shownFaces.map(faceElement), ...shownEmojis.map((emoji) => span('map-group-emoji', emoji)));
  if (together) {
    // Who's there, by name: it reads as one spot with these people at it.
    const names = group.map((item) => item.label);
    const extra = names.length - TOGETHER_NAMES;
    const names_ = span('map-group-names', extra > 0 ? `${names.slice(0, TOGETHER_NAMES).join(', ')} +${extra}` : listJoin(names));
    // The map stays left-to-right; the names read in the app's direction.
    names_.dir = document.documentElement.dir || 'auto';
    root.append(names_);
  } else {
    const more = group.length - shownFaces.length - shownEmojis.length;
    if (more > 0) root.append(span('map-group-more', `+${more}`));
    if (faces.length > 1) root.append(span('map-group-count', String(faces.length)));
  }
  root.setAttribute('aria-label', listJoin(group.map((item) => item.label)));
}

function groupElement(onClick: () => void) {
  return tappable(span('map-group'), '', onClick);
}

// What the things drawn as `shown` turned into, or came from when the maps are swapped.
function counterparts(shown: string, from: Map<string, string>, to: Map<string, string>) {
  const found = new Set<string>();
  from.forEach((value, key) => {
    const other = to.get(key);
    if (value === shown && other) found.add(other);
  });
  return [...found];
}

const centerOf = (items: Placed[]): [number, number] => [
  items.reduce((sum, item) => sum + item.lng, 0) / items.length,
  items.reduce((sum, item) => sum + item.lat, 0) / items.length,
];

// Hides what's crowded behind one bubble per group.
// Whatever changed glides: into the bubble that took it, out of the bubble it came from. A bubble
// that gains or loses someone stays and slides to its new middle. One that splits in several
// directions has nowhere to go, so it fades where it is.
function arrangeMarkers(maplibre: typeof import('maplibre-gl'), map: MapLibreMap, stores: Stores, items: Placed[], onGroup: (id: string) => void) {
  const clusters = clustersOf(map, stores, items);
  const before = new Map(stores.shownAs);
  const after = stores.shownAs;
  after.clear();
  stores.cluster.clear();
  for (const item of items) after.set(keyOf(item), keyOf(item));
  for (const cluster of clusters) {
    for (const item of cluster.items) {
      stores.cluster.set(keyOf(item), cluster.id);
      after.set(keyOf(item), cluster.id);
    }
  }

  // Bubbles: kept, refilled and moved when they change; made when new; retired when gone.
  const retired = new Map<string, Marker>();
  const live = new Set<string>();
  stores.groupItems.clear();
  for (const cluster of clusters) {
    live.add(cluster.id);
    stores.groupItems.set(cluster.id, cluster);
    const center = centerOf(cluster.items);
    const existing = stores.groups.get(cluster.id);
    if (existing) {
      const element = existing.getElement();
      const was = screenAt(map, existing);
      existing.setLngLat(center);
      fillGroup(element, cluster.items, cluster.together);
      const moved = was.sub(screenAt(map, existing));
      if (element.style.display !== 'none' && !flights.has(element) && moved.mag() > 1) glide(element, { ...HOME, translate: pixels(moved.x, moved.y) }, HOME);
      continue;
    }
    const element = groupElement(() => onGroup(cluster.id));
    fillGroup(element, cluster.items, cluster.together);
    const label = element.getAttribute('aria-label');
    const marker = new maplibre.Marker({ element }).setLngLat(center).addTo(map);
    if (label) element.setAttribute('aria-label', label);
    stores.groups.set(cluster.id, marker);
  }
  stores.groups.forEach((marker, id) => {
    if (live.has(id)) return;
    retired.set(id, marker);
    stores.groups.delete(id);
  });

  const own = new Map(items.map((item) => [keyOf(item), stores[item.store].get(item.id)?.marker]));
  const markerOf = (shown: string | undefined) => (shown ? (retired.get(shown) ?? stores.groups.get(shown) ?? own.get(shown)) : undefined);
  // From `marker` to wherever `other` is; staying put without one.
  const gap = (marker: Marker, other: Marker | undefined) => {
    if (!other) return pixels(0, 0);
    const distance = screenAt(map, other).sub(screenAt(map, marker));
    return pixels(distance.x, distance.y);
  };
  const shownAfter = new Set(after.values());
  const shownBefore = new Set(before.values());

  for (const shown of shownBefore) {
    const marker = markerOf(shown);
    if (!marker || shownAfter.has(shown)) continue;
    const element = marker.getElement();
    const into = counterparts(shown, before, after);
    element.style.pointerEvents = 'none';
    glide(element, HOME, { translate: gap(marker, into.length === 1 ? markerOf(into[0]) : undefined), opacity: 0 }, () => {
      if (retired.has(shown)) marker.remove();
      else element.style.display = 'none';
    });
  }
  // A bubble that only just went has nothing to fade out of: it's simply gone.
  retired.forEach((marker, id) => {
    if (!shownBefore.has(id)) marker.remove();
  });
  for (const shown of shownAfter) {
    const marker = markerOf(shown);
    const from = counterparts(shown, after, before);
    // Nothing to come out of: it's new on the map, not leaving a bubble.
    if (!marker || from.length === 0 || shownBefore.has(shown)) continue;
    const element = marker.getElement();
    element.style.display = '';
    element.style.pointerEvents = '';
    glide(element, { translate: gap(marker, from.length === 1 ? markerOf(from[0]) : undefined), opacity: 0 }, HOME);
  }
  for (const item of items) {
    const element = own.get(keyOf(item))?.getElement();
    if (!element || flights.has(element)) continue;
    element.style.display = after.get(keyOf(item)) === keyOf(item) ? '' : 'none';
    element.style.pointerEvents = '';
  }
  tuckTags(stores);
}

const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// People come first. A place's tag, or a bubble of places and pins, that would cover someone or poke
// out from behind them steps aside while they're there; the circle on the map still shows the place.
function tuckTags(stores: Stores) {
  const shown = (marker: Marker) => marker.getElement().style.display !== 'none';
  const people = [...stores.people.values()].map(({ marker }) => marker);
  const peopleBubbles = [...stores.groups.values()].filter((marker) => marker.getElement().classList.contains('is-people'));
  const blockers = [...people, ...peopleBubbles].filter(shown).map((marker) => marker.getElement().getBoundingClientRect());
  const tuckable = [
    ...[stores.places, stores.errands, stores.things].flatMap((store) => [...store.values()].map(({ marker }) => marker)),
    ...[...stores.groups.values()].filter((marker) => !marker.getElement().classList.contains('is-people')),
  ];
  for (const marker of tuckable) {
    if (!shown(marker)) continue;
    const element = marker.getElement();
    const rect = element.getBoundingClientRect();
    element.classList.toggle('is-tucked', blockers.some((blocker) => overlaps(rect, blocker)));
  }
}

export function FamilyMap({
  people,
  places,
  errands,
  things,
  trail = null,
  focus,
  pick,
  onPick,
  onPerson,
  onTogether,
  onPlace,
  onErrand,
  onThing,
}: {
  people: MapPerson[];
  places: MapPlace[];
  errands: MapErrand[];
  things: MapThing[];
  trail?: MapTrail | null;
  focus: MapFocus | null;
  /** While set, a tap on the map moves the pin instead of selecting anything. */
  pick: MapPick | null;
  onPick: (point: Point) => void;
  onPerson: (id: string) => void;
  /** A tap on people together at one spot: which of them to look at. */
  onTogether: (ids: string[]) => void;
  onPlace: (id: string) => void;
  onErrand: (id: string) => void;
  onThing: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ maplibre: typeof import('maplibre-gl'); map: MapLibreMap } | null>(null);
  // The map frames the family by itself until the viewer takes over.
  const framing = useRef({ framed: false, viewerMoved: false });
  const pickMarker = useRef<Marker | null>(null);
  const stores = useRef<Stores>({
    people: new Map(),
    places: new Map(),
    errands: new Map(),
    things: new Map(),
    groups: new Map(),
    groupItems: new Map(),
    shownAs: new Map(),
    cluster: new Map(),
    seq: 0,
  });
  // Marker clicks and map taps were wired once; they read the latest handlers from here.
  const picking = !!pick;
  const unlessPicking = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A) => {
    if (!latest.current.picking) handler(...args);
  };
  // People together at one spot: the page asks which of them, while the map goes to the spot.
  // Anything else zooms in just far enough to split, centred on it.
  const onGroup = (id: string) => {
    const cluster = stores.current.groupItems.get(id);
    if (!loaded || !cluster) return;
    const { map } = loaded;
    const zoom = map.getZoom();
    const group = cluster.items;
    framing.current.viewerMoved = true;
    if (cluster.together) {
      latest.current.onTogether(group.map((item) => item.id));
      map.resize();
      const offset: [number, number] = [0, -map.getContainer().clientHeight / 5];
      map.flyTo({ center: centerOf(group), zoom: Math.max(zoom, PERSON_ZOOM), offset, duration: 600 });
      return;
    }
    const points = group.map((item) => ({ item, at: map.project([item.lng, item.lat]) }));
    const split = splitZoom(zoom, points) + 0.3;
    const target = Math.min(split, group.some((item) => item.person) ? MAX_SPLIT_ZOOM : BREAK_ZOOM + 0.1);
    map.flyTo({ center: centerOf(group), zoom: Math.max(target, zoom + 0.5), duration: 600 });
  };
  const current = {
    picking,
    onPick,
    onPerson: unlessPicking(onPerson),
    onTogether: unlessPicking(onTogether),
    onPlace: unlessPicking(onPlace),
    onErrand: unlessPicking(onErrand),
    onThing: unlessPicking(onThing),
    onGroup: unlessPicking(onGroup),
    items: [
      ...people.map((p): Placed => ({ store: 'people', id: p.id, lat: p.lat, lng: p.lng, label: firstName(p.displayName), person: p })),
      ...places.map((p): Placed => ({ store: 'places', id: p.id, lat: p.lat, lng: p.lng, label: p.name, emoji: KIND_EMOJI[p.kind] })),
      ...errands.map((e): Placed => ({ store: 'errands', id: e.id, lat: e.lat, lng: e.lng, label: e.title, emoji: '🛒' })),
      ...things.map((x): Placed => ({ store: 'things', id: x.id, lat: x.lat, lng: x.lng, label: x.name, emoji: x.emoji })),
    ],
    shapes: shapesOf(people, places, pick),
    trail,
  };
  const latest = useRef(current);
  latest.current = current;

  const frameEveryone = useCallback(
    (maplibre: typeof import('maplibre-gl'), map: MapLibreMap) => {
      const points = [...people, ...places, ...errands, ...things];
      if (points.length === 0) return;
      const bounds = new maplibre.LngLatBounds();
      for (const point of points) bounds.extend([point.lng, point.lat]);
      // The container may have changed size since the map was created (a sheet closing, a rotated phone).
      map.resize();
      map.fitBounds(bounds, { padding: FRAME_PADDING, maxZoom: 15 });
    },
    [people, places, errands, things],
  );

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    const dark = window.matchMedia(DARK_QUERY);
    const followTheme = () => map?.setStyle(styleUrl(dark.matches), { diff: false });
    // MapLibre needs a browser, so it can't load during server rendering.
    import('maplibre-gl').then((maplibre) => {
      if (cancelled || !containerRef.current) return;
      // Without this, Hebrew labels come out backwards. Loads only once there's Hebrew to show.
      if (maplibre.getRTLTextPluginStatus() === 'unavailable') {
        maplibre.setRTLTextPlugin('/vendor/mapbox-gl-rtl-text.js', true).catch(() => undefined);
      }
      map = new maplibre.Map({
        container: containerRef.current,
        style: styleUrl(dark.matches),
        ...START_VIEW,
        attributionControl: { compact: false },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-left');
      // A new style (theme change) drops every layer added on top of it.
      map.on('style.load', () => {
        if (!map) return;
        labelInAppLanguage(map);
        addShapes(map, latest.current.shapes);
        addTrail(map, latest.current.trail);
      });
      map.on('click', (e) => {
        if (!latest.current.picking || !map) return;
        latest.current.onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        // From far out a fingertip covers whole neighbourhoods: bring the street up to choose the exact spot.
        if (map.getZoom() < PICK_ZOOM) map.flyTo({ center: e.lngLat, zoom: PICK_ZOOM });
      });
      const viewerMoved = (e: { originalEvent?: unknown }) => {
        if (e.originalEvent) framing.current.viewerMoved = true;
      };
      map.on('dragstart', viewerMoved);
      map.on('zoomstart', viewerMoved);
      map.on('zoom', () => map && arrangeMarkers(maplibre, map, stores.current, latest.current.items, latest.current.onGroup));
      dark.addEventListener('change', followTheme);
      setLoaded({ maplibre, map });
    });
    const markers = stores.current;
    return () => {
      cancelled = true;
      dark.removeEventListener('change', followTheme);
      map?.remove();
      for (const store of [markers.people, markers.places, markers.errands, markers.things, markers.groups, markers.groupItems, markers.shownAs, markers.cluster]) store.clear();
      pickMarker.current = null;
      framing.current = { framed: false, viewerMoved: false };
      setLoaded(null);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    loaded.map.getCanvas().style.cursor = picking ? 'crosshair' : '';
  }, [loaded, picking]);

  useEffect(() => {
    if (!loaded) return;
    const { maplibre, map } = loaded;
    const someoneNew = syncMarkers(
      maplibre,
      map,
      stores.current.people,
      people.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        look: `${p.displayName}|${p.avatarAt}|${p.stale}|${p.emoji}|${p.eta}`,
        make: () => personElement(p, () => latest.current.onPerson(p.id)),
        update: (element: HTMLElement) => movePerson(element, p),
      })),
    );
    syncMarkers(
      maplibre,
      map,
      stores.current.places,
      // The tag sits on the top edge of the circle: at its centre it would cover whoever is there.
      places.map((p) => ({
        id: p.id,
        lat: p.lat + p.radiusM / 111_320,
        lng: p.lng,
        look: `${p.name}|${p.kind}`,
        anchor: 'bottom' as const,
        make: () => placeElement(p, () => latest.current.onPlace(p.id)),
      })),
    );
    syncMarkers(
      maplibre,
      map,
      stores.current.errands,
      errands.map((e) => ({ id: e.id, lat: e.lat, lng: e.lng, look: `${e.title}|${e.claimed}`, make: () => errandElement(e, () => latest.current.onErrand(e.id)) })),
    );
    syncMarkers(
      maplibre,
      map,
      stores.current.things,
      things.map((x) => ({ id: x.id, lat: x.lat, lng: x.lng, look: `${x.name}|${x.emoji}`, make: () => thingElement(x, () => latest.current.onThing(x.id)) })),
    );

    const source = map.getSource(SHAPES) as { setData: (data: unknown) => void } | undefined;
    source?.setData(shapesOf(people, places, pick));

    // Once when there's something to show, and when someone appears, until the viewer moves the map themselves.
    const { framed, viewerMoved } = framing.current;
    if (!viewerMoved && !picking && (someoneNew || !framed)) {
      frameEveryone(maplibre, map);
      framing.current.framed = people.length + places.length + errands.length + things.length > 0;
    }
    arrangeMarkers(maplibre, map, stores.current, latest.current.items, latest.current.onGroup);
  }, [loaded, people, places, errands, things, pick, picking, frameEveryone]);

  // A trail comes into view whole, clear of the card over the bottom of the map.
  useEffect(() => {
    if (!loaded) return;
    const { map } = loaded;
    const source = map.getSource(TRAIL) as { setData: (data: unknown) => void } | undefined;
    source?.setData(trailData(trail));
    if (map.getLayer(`${TRAIL}-line`)) map.setPaintProperty(`${TRAIL}-line`, 'line-gradient', trailGradient(trail?.hue ?? 210) as any);
  }, [loaded, trail]);

  // Only when a trail is first shown, not each time it grows.
  const trailKey = trail?.key;
  useEffect(() => {
    const shown = latest.current.trail;
    if (!loaded || !shown || shown.points.length < 2) return;
    const { maplibre, map } = loaded;
    const bounds = new maplibre.LngLatBounds();
    for (const point of shown.points) bounds.extend([point.lng, point.lat]);
    framing.current.viewerMoved = true;
    map.resize();
    const height = map.getContainer().clientHeight;
    map.fitBounds(bounds, { padding: { top: 60, bottom: Math.round(height * 0.4), left: 50, right: 50 }, maxZoom: 16, duration: 700 });
  }, [loaded, trailKey]);

  // The pin being placed. Dragging fine-tunes it, which a fingertip on a small map can't do by tapping.
  useEffect(() => {
    if (!loaded) return;
    const point = pick?.point ?? null;
    if (!point) {
      pickMarker.current?.remove();
      pickMarker.current = null;
      return;
    }
    if (!pickMarker.current) {
      const marker = new loaded.maplibre.Marker({ color: PICK_COLOR, draggable: true }).setLngLat([point.lng, point.lat]).addTo(loaded.map);
      marker.getElement().classList.add('map-pick');
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLngLat();
        latest.current.onPick({ lat, lng });
      });
      pickMarker.current = marker;
    } else {
      pickMarker.current.setLngLat([point.lng, point.lat]);
    }
  }, [loaded, pick?.point]);

  useEffect(() => {
    if (!loaded || !focus) return;
    framing.current.viewerMoved = true;
    const { map } = loaded;
    map.resize();
    const zoom = Math.max(map.getZoom(), focus.zoom ?? 15);
    // Up by a fifth of the map: the card over its bottom would cover the middle.
    const offset: [number, number] = focus.lift ? [0, -map.getContainer().clientHeight / 5] : [0, 0];
    map.flyTo({ center: [focus.lng, focus.lat], zoom, offset, duration: 700 });
  }, [loaded, focus]);

  // Stays LTR in Hebrew too: the map's controls are positioned from the left.
  // The picking state goes in an attribute: MapLibre owns the class list of this element.
  return (
    <div className="family-map-frame">
      <div ref={containerRef} className="family-map" data-picking={picking} dir="ltr" />
      <button
        type="button"
        className="map-fit"
        aria-label={t('locator.showEveryone')}
        title={t('locator.showEveryone')}
        onClick={() => {
          if (!loaded) return;
          framing.current.viewerMoved = false;
          frameEveryone(loaded.maplibre, loaded.map);
        }}
      >
        <Icon name="users" size={18} />
      </button>
    </div>
  );
}
