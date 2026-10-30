'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
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
  /** Set when they share only their neighbourhood: the map draws a halo this big instead of a sharp position. */
  blurRadiusM: number | null;
};
export type MapPlace = { id: string; name: string; kind: PlaceKind; lat: number; lng: number; radiusM: number };
export type MapErrand = { id: string; title: string; lat: number; lng: number; claimed: boolean };
export type MapThing = { id: string; name: string; emoji: string; lat: number; lng: number };
export type MapFocus = { key: number; lat: number; lng: number };

type Point = { lat: number; lng: number };
/** Choosing a spot: where the pin is so far, and the area a place would cover around it. */
export type MapPick = { point: Point | null; radiusM?: number };

const DARK_QUERY = '(prefers-color-scheme: dark)';
const CALM_QUERY = '(prefers-reduced-motion: reduce)';
const SHAPES = 'family-shapes';
const PICK_COLOR = '#1c7ed6';
// Where a family with nothing on the map yet starts: zoomed in enough to find a street, unlike the whole globe.
const START_VIEW = { center: [34.85, 31.7] as [number, number], zoom: 6.5 };
// Further out than this, anything that would collide on screen merges into one bubble; a tap on it zooms in.
const BREAK_ZOOM = 15;
const GROUP_PX = 72;
const GROUP_FACES = 3;
const GROUP_EMOJIS = 2;
// From the zoom above, people closer on screen than this would hide each other, so they fan out around their shared spot.
const CROWDED_PX = 44;
const PICK_ZOOM = 15;
// They line up side by side, rows at most this long, so that every name tag stays readable.
const FAN_COLUMNS = 3;
const FAN_STEP = { x: 62, y: 76 };
// How long a marker takes to slide into a bubble or back out of it.
const GLIDE_MS = 280;
const GLIDE_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
// Room for name tags under a marker, place tags above one, and people fanned out around their spot.
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

  const label = span('map-person-name', firstName(person.displayName));
  root.append(faceElement(person), span('map-person-pulse', person.emoji), label);
  if (person.eta) root.append(span('map-person-eta', person.eta));
  return root;
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
type MarkerItem = { id: string; lat: number; lng: number; look: string; make: () => HTMLElement; anchor?: 'center' | 'bottom' };

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
type Stores = Record<StoreName, MarkerStore> & { groups: MarkerStore; shownAs: Map<string, string> };
// One thing on the map, as the grouping sees it: a person has a face, anything else an emoji.
type Placed = { store: StoreName; id: string; lat: number; lng: number; label: string; person?: MapPerson; emoji?: string };

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

// Things close enough on screen to collide, including through a neighbour. Street level has none: there's room there.
function crowdedGroups(map: MapLibreMap, items: Placed[]) {
  if (map.getZoom() >= BREAK_ZOOM) return [];
  const points = items.map((item) => ({ item, at: map.project([item.lng, item.lat]) }));
  const left = new Set(points);
  const groups: Placed[][] = [];
  for (const start of points) {
    if (!left.delete(start)) continue;
    const group = [start];
    for (const member of group) {
      for (const other of left) {
        if (member.at.dist(other.at) >= GROUP_PX) continue;
        left.delete(other);
        group.push(other);
      }
    }
    if (group.length > 1) groups.push(group.map((point) => point.item));
  }
  return groups;
}

function groupElement(group: Placed[], onClick: () => void) {
  const root = tappable(span('map-group'), listJoin(group.map((item) => item.label)), onClick);
  const faces = group.flatMap((item) => (item.person ? [item.person] : []));
  const emojis = group.flatMap((item) => (item.emoji ? [item.emoji] : []));
  const shownFaces = faces.slice(0, GROUP_FACES);
  const shownEmojis = emojis.slice(0, GROUP_EMOJIS);
  root.append(...shownFaces.map(faceElement), ...shownEmojis.map((emoji) => span('map-group-emoji', emoji)));
  const more = group.length - shownFaces.length - shownEmojis.length;
  if (more > 0) root.append(span('map-group-more', `+${more}`));
  return root;
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

// Hides what's crowded behind one bubble per group, then lets whoever is left share their spot.
// Whatever changed glides: into the bubble that took it, out of the bubble it came from. A bubble
// that splits in several directions has nowhere to go, so it fades where it is.
function arrangeMarkers(maplibre: typeof import('maplibre-gl'), map: MapLibreMap, stores: Stores, items: Placed[], onGroup: (group: Placed[]) => void) {
  const groups = crowdedGroups(map, items);
  const before = new Map(stores.shownAs);
  const after = stores.shownAs;
  after.clear();
  for (const item of items) after.set(keyOf(item), keyOf(item));
  const retired = new Map<string, Marker>();
  syncMarkers(
    maplibre,
    map,
    stores.groups,
    groups.map((group) => {
      const id = group.map(keyOf).join();
      for (const item of group) after.set(keyOf(item), id);
      return {
        id,
        lat: group.reduce((sum, item) => sum + item.lat, 0) / group.length,
        lng: group.reduce((sum, item) => sum + item.lng, 0) / group.length,
        look: group.map((item) => `${item.label}|${item.person?.avatarAt}|${item.emoji}`).join(),
        make: () => groupElement(group, () => onGroup(group)),
      };
    }),
    (id, marker) => retired.set(id, marker),
  );
  const standsAlone = (key: string) => before.get(key) === key && after.get(key) === key;
  spreadPeople(
    map,
    stores.people,
    items.flatMap((item) => (item.person ? [item.person] : [])),
    standsAlone,
  );

  const own = new Map(items.map((item) => [keyOf(item), stores[item.store].get(item.id)?.marker]));
  const markerOf = (shown: string | undefined) => (shown ? (retired.get(shown) ?? stores.groups.get(shown)?.marker ?? own.get(shown)) : undefined);
  // From `marker` to wherever `other` is; staying put without one.
  const gap = (marker: Marker, other: Marker | undefined) => {
    if (!other) return pixels(0, 0);
    const distance = screenAt(map, other).sub(screenAt(map, marker));
    return pixels(distance.x, distance.y);
  };

  for (const shown of new Set(before.values())) {
    const marker = markerOf(shown);
    if (!marker || [...after.values()].includes(shown)) continue;
    const element = marker.getElement();
    const into = counterparts(shown, before, after);
    element.style.pointerEvents = 'none';
    glide(element, HOME, { translate: gap(marker, into.length === 1 ? markerOf(into[0]) : undefined), opacity: 0 }, () => {
      if (retired.has(shown)) marker.remove();
      else element.style.display = 'none';
    });
  }
  for (const shown of new Set(after.values())) {
    const marker = markerOf(shown);
    const from = counterparts(shown, after, before);
    // Nothing to come out of: it's new on the map, not leaving a bubble.
    if (!marker || from.length === 0 || [...before.values()].includes(shown)) continue;
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
}

// Fans out people who would otherwise sit on top of each other. Everyone at home is the usual case.
function spreadPeople(map: MapLibreMap, store: MarkerStore, people: MapPerson[], standsAlone: (key: string) => boolean) {
  const points = people.map((p) => ({ id: p.id, at: map.project([p.lng, p.lat]) }));
  const seen = new Set<string>();
  for (const point of points) {
    if (seen.has(point.id)) continue;
    const group = points.filter((other) => !seen.has(other.id) && point.at.dist(other.at) < CROWDED_PX);
    group.forEach((member, index) => {
      seen.add(member.id);
      const columns = Math.min(group.length, FAN_COLUMNS);
      const rows = Math.ceil(group.length / FAN_COLUMNS);
      const x = ((index % FAN_COLUMNS) - (columns - 1) / 2) * FAN_STEP.x;
      const y = (Math.floor(index / FAN_COLUMNS) - (rows - 1) / 2) * FAN_STEP.y;
      const marker = store.get(member.id)?.marker;
      if (!marker) return;
      const was = marker.getOffset();
      if (was.x === x && was.y === y) return;
      marker.setOffset([x, y]);
      // Only someone already on screen has a spot to slide from.
      if (standsAlone(`people:${member.id}`)) glide(marker.getElement(), { ...HOME, translate: pixels(was.x - x, was.y - y) }, HOME);
    });
  }
}

export function FamilyMap({
  people,
  places,
  errands,
  things,
  focus,
  pick,
  onPick,
  onPerson,
  onPlace,
  onErrand,
  onThing,
}: {
  people: MapPerson[];
  places: MapPlace[];
  errands: MapErrand[];
  things: MapThing[];
  focus: MapFocus | null;
  /** While set, a tap on the map moves the pin instead of selecting anything. */
  pick: MapPick | null;
  onPick: (point: Point) => void;
  onPerson: (id: string) => void;
  onPlace: (id: string) => void;
  onErrand: (id: string) => void;
  onThing: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ maplibre: typeof import('maplibre-gl'); map: MapLibreMap } | null>(null);
  // The map frames the family by itself until the viewer takes over.
  const framing = useRef({ framed: false, viewerMoved: false });
  const pickMarker = useRef<Marker | null>(null);
  const stores = useRef<Stores>({ people: new Map(), places: new Map(), errands: new Map(), things: new Map(), groups: new Map(), shownAs: new Map() });
  // Marker clicks and map taps were wired once; they read the latest handlers from here.
  const picking = !!pick;
  const unlessPicking = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A) => {
    if (!latest.current.picking) handler(...args);
  };
  const onGroup = (group: Placed[]) => {
    if (!loaded) return;
    const bounds = new loaded.maplibre.LngLatBounds();
    for (const item of group) bounds.extend([item.lng, item.lat]);
    framing.current.viewerMoved = true;
    // Past the zoom where groups end, so this can't land on the same bubble again.
    loaded.map.fitBounds(bounds, { padding: FRAME_PADDING, maxZoom: BREAK_ZOOM + 0.5 });
  };
  const current = {
    picking,
    onPick,
    onPerson: unlessPicking(onPerson),
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
      Object.values(markers).forEach((store) => store.clear());
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
    loaded.map.resize();
    loaded.map.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(loaded.map.getZoom(), 15) });
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
