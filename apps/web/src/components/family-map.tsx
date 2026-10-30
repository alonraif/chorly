'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { firstName } from '../lib/format';
import { getLocale } from '../lib/i18n';
import { hueFor, initials } from './avatar';

export type MapPerson = {
  id: string;
  displayName: string;
  avatarAt: string | null;
  lat: number;
  lng: number;
  stale: boolean;
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

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

// Built as an element, not an HTML string, so names can't inject markup into the map.
function markerElement(person: MapPerson) {
  const root = document.createElement('div');
  root.className = `map-person ${person.stale ? 'is-stale' : ''}`;

  const face = document.createElement('span');
  face.className = 'avatar';
  face.style.setProperty('--hue', String(hueFor(person.id)));
  face.textContent = initials(person.displayName);
  if (person.avatarAt) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `/api/users/${person.id}/avatar?v=${encodeURIComponent(person.avatarAt)}`;
    img.onload = () => face.replaceChildren(img);
  }

  const name = document.createElement('span');
  name.className = 'map-person-name';
  name.textContent = firstName(person.displayName);

  root.append(face, name);
  return root;
}

export function FamilyMap({ people, focus }: { people: MapPerson[]; focus: { id: string } | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ maplibre: typeof import('maplibre-gl'); map: MapLibreMap } | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; look: string }>());

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
      map.on('style.load', () => map && labelInAppLanguage(map));
      dark.addEventListener('change', followTheme);
      setLoaded({ maplibre, map });
    });
    return () => {
      cancelled = true;
      dark.removeEventListener('change', followTheme);
      map?.remove();
      markers.current.clear();
      setLoaded(null);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const { maplibre, map } = loaded;
    const seen = new Set<string>();
    let someoneNew = false;
    for (const person of people) {
      seen.add(person.id);
      const look = `${person.displayName}|${person.avatarAt}|${person.stale}`;
      const existing = markers.current.get(person.id);
      if (existing && existing.look === look) {
        existing.marker.setLngLat([person.lng, person.lat]);
        continue;
      }
      existing?.marker.remove();
      someoneNew ||= !existing;
      const marker = new maplibre.Marker({ element: markerElement(person) }).setLngLat([person.lng, person.lat]).addTo(map);
      markers.current.set(person.id, { marker, look });
    }
    markers.current.forEach(({ marker }, id) => {
      if (seen.has(id)) return;
      marker.remove();
      markers.current.delete(id);
    });
    // Only when someone appears: otherwise the map stays wherever the viewer moved it.
    if (someoneNew) {
      const bounds = new maplibre.LngLatBounds();
      for (const person of people) bounds.extend([person.lng, person.lat]);
      map.fitBounds(bounds, { padding: 64, maxZoom: 15 });
    }
  }, [loaded, people]);

  useEffect(() => {
    if (!loaded || !focus) return;
    const target = markers.current.get(focus.id);
    if (target) loaded.map.flyTo({ center: target.marker.getLngLat(), zoom: Math.max(loaded.map.getZoom(), 15) });
  }, [loaded, focus]);

  // Stays LTR in Hebrew too: the map's controls are positioned from the left.
  return <div ref={containerRef} className="family-map" dir="ltr" />;
}
