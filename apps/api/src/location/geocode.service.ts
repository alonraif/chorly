import { Injectable, ServiceUnavailableException } from '@nestjs/common';

const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const RESULTS = 5;
const TIMEOUT_MS = 8_000;
// Nominatim's usage policy: at most one request a second, from an app that says who it is.
const MIN_GAP_MS = 1_000;
const NEAR_DEGREES = 1;

type Geocode = { query: string; language?: string; near?: { lat: number; lng: number } };
type NominatimHit = { display_name: string; lat: string; lon: string };

@Injectable()
export class GeocodeService {
  private nextSlot = 0;

  async search({ query, language, near }: Geocode) {
    const url = new URL(SEARCH_URL);
    url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: String(RESULTS) }).toString();
    if (language) url.searchParams.set('accept-language', language);
    if (near) {
      const { lat, lng } = near;
      url.searchParams.set('viewbox', [lng - NEAR_DEGREES, lat + NEAR_DEGREES, lng + NEAR_DEGREES, lat - NEAR_DEGREES].join(','));
    }

    await this.waitForSlot();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `Chorly family organizer (${process.env.APP_BASE_URL ?? 'self-hosted'})` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Nominatim answered ${res.status}`);
      const hits = (await res.json()) as NominatimHit[];
      return hits.map((hit) => ({ label: hit.display_name, lat: Number(hit.lat), lng: Number(hit.lon) }));
    } catch {
      throw new ServiceUnavailableException('geocode_failed');
    }
  }

  private async waitForSlot() {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + MIN_GAP_MS;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  }
}
