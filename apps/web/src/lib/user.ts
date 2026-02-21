'use client';

export const CURRENT_USER_KEY = 'chorly.currentUserId';
export const CURRENT_TENANT_KEY = 'chorly.currentTenantId';
export const CURRENT_LOCALE_KEY = 'chorly.currentLocale';

export function getCurrentUserId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CURRENT_USER_KEY);
}

export function setCurrentUserId(id: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CURRENT_USER_KEY, id);
}

export function clearCurrentUserId() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CURRENT_USER_KEY);
}

export function getCurrentTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CURRENT_TENANT_KEY);
}

export function setCurrentTenantId(id: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CURRENT_TENANT_KEY, id);
}

export function clearCurrentTenantId() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CURRENT_TENANT_KEY);
}

export function getCurrentLocale(): 'en' | 'he' | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(CURRENT_LOCALE_KEY);
  if (value === 'en' || value === 'he') return value;
  return null;
}

export function setCurrentLocale(locale: 'en' | 'he') {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CURRENT_LOCALE_KEY, locale);
}

export function clearCurrentLocale() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CURRENT_LOCALE_KEY);
}
