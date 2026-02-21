'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getCurrentLocale, getCurrentUserId, setCurrentLocale } from '../lib/user';

type Locale = 'en' | 'he';
type User = { id: string; locale: Locale };

function applyDocumentLocale(locale: Locale) {
  const dir = locale === 'he' ? 'rtl' : 'ltr';
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
}

export function LocaleDirection() {
  const [locale, setLocale] = useState<Locale>(() => getCurrentLocale() || 'en');

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  useEffect(() => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) return;

    api.get('/users')
      .then((users: User[]) => {
        const currentUser = users.find((user) => user.id === currentUserId);
        if (!currentUser) return;
        setCurrentLocale(currentUser.locale);
        setLocale(currentUser.locale);
      })
      .catch(() => {
        // Keep current locale if request fails.
      });
  }, []);

  return null;
}
