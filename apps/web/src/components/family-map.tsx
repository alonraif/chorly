'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { firstName } from '../lib/format';
import { getLocale } from '../lib/i18n';
import { KIND_COLOR, KIND_EMOJI, type PlaceKind } from '../lib/places';
import { hueFor, initials } from './avatar';

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

const DARK_QUERY = '(prefers-color-scheme: dark)';
const SHAPES = 'family-shapes';

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

function shapesOf(people: MapPerson[], places: MapPlace[]) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...places.map((p) => circle(p, p.radiusM, { color: KIND_COLOR[p.kind], halo: '0' })),
      ...people.filter((p) => p.blurRadiusM).map((p) => circle(p, p.blurRadiusM!, { color: '#495057', halo: '1' })),
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

// Everything below is built as elements, not HTML strings, so names can't inject markup into the map.
function personElement(person: MapPerson, onClick: () => void) {
  const root = document.createElement('div');
  root.className = `map-person ${person.stale ? 'is-stale' : ''}`;
  root.addEventListener('click', onClick);

  const face = span('avatar');
  face.style.setProperty('--hue', String(hueFor(person.id)));
  face.textContent = initials(person.displayName);
  if (person.avatarAt) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `/api/users/${person.id}/avatar?v=${encodeURIComponent(person.avatarAt)}`;
    img.onload = () => face.replaceChildren(img);
  }

  const label = span('map-person-name', firstName(person.displayName));
  root.append(face, span('map-person-pulse', person.emoji), label);
  if (person.eta) root.append(span('map-person-eta', person.eta));
  return root;
}

function placeElement(place: MapPlace, onClick: () => void) {
  const root = span('map-place');
  root.addEventListener('click', onClick);
  root.append(span('map-place-emoji', KIND_EMOJI[place.kind]), span('map-place-name', place.name));
  return root;
}

function errandElement(errand: MapErrand, onClick: () => void) {
  const root = span(`map-errand ${errand.claimed ? 'is-claimed' : ''}`);
  root.addEventListener('click', onClick);
  root.append(span('map-errand-pin', '🛒'), span('map-errand-title', errand.title));
  return root;
}

function thingElement(thing: MapThing, onClick: () => void) {
  const root = span('map-thing');
  root.addEventListener('click', onClick);
  root.append(span('map-thing-emoji', thing.emoji), span('map-thing-name', thing.name));
  return root;
}

type MarkerStore = Map<string, { marker: Marker; look: string }>;
type MarkerItem = { id: string; lat: number; lng: number; look: string; make: () => HTMLElement };

// Keeps one marker per item: moved when the item moves, rebuilt only when how it looks changes.
function syncMarkers(maplibre: typeof import('maplibre-gl'), map: MapLibreMap, store: MarkerStore, items: MarkerItem[]) {
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
    const marker = new maplibre.Marker({ element: item.make() }).setLngLat([item.lng, item.lat]).addTo(map);
    store.set(item.id, { marker, look: item.look });
  }
  store.forEach(({ marker }, id) => {
    if (seen.has(id)) return;
    marker.remove();
    store.delete(id);
  });
  return added;
}

export function FamilyMap({
  people,
  places,
  errands,
  things,
  focus,
  picking,
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
  /** While set, a tap on the map chooses a spot instead of selecting anything. */
  picking: boolean;
  onPick: (point: Point) => void;
  onPerson: (id: string) => void;
  onPlace: (id: string) => void;
  onErrand: (id: string) => void;
  onThing: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ maplibre: typeof import('maplibre-gl'); map: MapLibreMap } | null>(null);
  const stores = useRef({ people: new Map() as MarkerStore, places: new Map() as MarkerStore, errands: new Map() as MarkerStore, things: new Map() as MarkerStore });
  // Marker clicks and map taps were wired once; they read the latest handlers from here.
  const latest = useRef({ picking, onPick, onPerson, onPlace, onErrand, onThing, shapes: shapesOf(people, places) });
  latest.current = { picking, onPick, onPerson, onPlace, onErrand, onThing, shapes: shapesOf(people, places) };

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
        center: [0, 20],
        zoom: 1,
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
        if (latest.current.picking) latest.current.onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      dark.addEventListener('change', followTheme);
      setLoaded({ maplibre, map });
    });
    const markers = stores.current;
    return () => {
      cancelled = true;
      dark.removeEventListener('change', followTheme);
      map?.remove();
      Object.values(markers).forEach((store) => store.clear());
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
      places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, look: `${p.name}|${p.kind}`, make: () => placeElement(p, () => latest.current.onPlace(p.id)) })),
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
    source?.setData(shapesOf(people, places));

    // Only when someone appears: otherwise the map stays wherever the viewer moved it.
    if (someoneNew) {
      const bounds = new maplibre.LngLatBounds();
      for (const person of people) bounds.extend([person.lng, person.lat]);
      // The container may have changed size since the map was created (a sheet closing, a rotated phone).
      map.resize();
      map.fitBounds(bounds, { padding: 64, maxZoom: 15 });
    }
  }, [loaded, people, places, errands, things]);

  useEffect(() => {
    if (!loaded || !focus) return;
    loaded.map.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(loaded.map.getZoom(), 15) });
  }, [loaded, focus]);

  // Stays LTR in Hebrew too: the map's controls are positioned from the left.
  // The picking state goes in an attribute: MapLibre owns the class list of this element.
  return <div ref={containerRef} className="family-map" data-picking={picking} dir="ltr" />;
}
