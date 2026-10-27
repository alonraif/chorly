'use client';

import { clearCurrentLocale, clearCurrentUserId } from './user';

// Same origin in every environment: Caddy (prod) or the Next.js rewrite (dev) forwards /api to the API.
const API_BASE = '/api';

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  headers.set('Content-Type', 'application/json');

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  if (res.status === 401 && !path.startsWith('/auth/')) {
    clearCurrentUserId();
    clearCurrentLocale();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.replace('/');
    }
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      msg = data?.message || JSON.stringify(data);
    } catch {
      // ignore json parse errors
    }
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, body?: unknown) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: (path: string, body?: unknown) => request(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
};
