export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

// Great-circle distance in metres.
export function distanceM(a: LatLng, b: LatLng) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Someone sharing "nearby" is placed at the middle of a grid cell about this wide, so the map
// shows roughly where they are without giving the street away.
const BLUR_STEP_DEG = 0.02;
export const BLUR_RADIUS_M = 1500;

export function blurLocation(point: LatLng): LatLng {
  const snap = (value: number) => (Math.floor(value / BLUR_STEP_DEG) + 0.5) * BLUR_STEP_DEG;
  return { lat: snap(point.lat), lng: snap(point.lng) };
}

export const TRIP_MODES = ['walk', 'drive'] as const;
export type TripModeName = (typeof TRIP_MODES)[number];

// Straight-line distance understates a real route, and there is no routing service here: an estimate is all it is.
const ROUTE_FACTOR = 1.35;
const SPEED_MPS: Record<TripModeName, number> = { walk: 1.3, drive: 9 };

export function tripEtaMinutes(from: LatLng, to: LatLng, mode: TripModeName) {
  return Math.max(1, Math.round((distanceM(from, to) * ROUTE_FACTOR) / SPEED_MPS[mode] / 60));
}

// A position older than this is where the person was, not where they are.
export const FRESH_LOCATION_MS = 30 * 60_000;
// Below this accuracy (metres) a fix is too vague to decide whether someone entered or left a place.
export const MAX_PLACE_ACCURACY_M = 150;
// Once inside a place, someone has to move this much further out than its radius before they count as gone.
export const PLACE_EXIT_FACTOR = 1.3;
// Errand pins remind whoever passes within this distance.
export const ERRAND_REMINDER_M = 300;
// Two people closer than this are together.
export const TOGETHER_M = 80;
// Speeds in metres per second.
export const MOVING_MPS = 1;
export const DRIVING_MPS = 6;
