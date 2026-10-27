'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { applyLocale, preferredLocale, type Locale } from '../lib/i18n';
import { CURRENT_LOCALE_KEY, LOCALE_EVENT } from '../lib/user';

// Applies the preferred language to <html lang/dir> and remounts the app when it changes
// so every string re-renders.
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale | null>(null);

  useEffect(() => {
    const sync = () => {
      const next = preferredLocale();
      applyLocale(next);
      setLocale(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === CURRENT_LOCALE_KEY) sync();
    };
    sync();
    window.addEventListener(LOCALE_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(LOCALE_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Nothing renders until the language is known, so there is no flash of the wrong language or direction.
  if (!locale) return null;
  return <Fragment key={locale}>{children}</Fragment>;
}
