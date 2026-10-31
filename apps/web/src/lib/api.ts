'use client';

import { clearCurrentUserId } from './user';

// Same origin in every environment: Caddy (prod) or the Next.js rewrite (dev) forwards /api to the API.
const API_BASE = '/api';

// A refusal from the server, as opposed to a request that never got an answer.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  if (res.status === 401 && !path.startsWith('/auth/')) {
    clearCurrentUserId();
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
    throw new ApiError(msg, res.status);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, body?: unknown) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: (path: string, body?: unknown) => request(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: (path: string, body?: unknown) => request(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
  upload: (path: string, blob: Blob) => request(path, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } }),
};
