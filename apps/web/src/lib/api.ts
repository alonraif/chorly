'use client';

import { getCurrentTenantId, getCurrentUserId } from './user';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  headers.set('Content-Type', 'application/json');

  const userId = getCurrentUserId();
  if (userId) headers.set('x-user-id', userId);

  const tenantId = getCurrentTenantId();
  if (tenantId) headers.set('x-tenant-id', tenantId);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

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
