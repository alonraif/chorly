'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { clearCurrentLocale, clearCurrentTenantId, clearCurrentUserId, getCurrentUserId } from '../lib/user';

type CurrentFamily = {
  id: string;
  name: string;
  defaultLocale: 'en' | 'he';
};

type SessionUser = {
  id: string;
  role: 'parent' | 'child';
};

const INACTIVITY_MS = 10 * 60 * 1000;

export function AppFrame({ children }: { children: ReactNode }) {
  const [familyName, setFamilyName] = useState('');
  const [isChildOnly, setIsChildOnly] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const logout = useCallback(() => {
    clearCurrentUserId();
    clearCurrentTenantId();
    clearCurrentLocale();
    setIsChildOnly(false);
    setIsLoggedIn(false);
    router.replace('/');
  }, [router]);

  useEffect(() => {
    if (!getCurrentUserId()) {
      setFamilyName('');
      return;
    }
    api
      .get('/family/current')
      .then((family: CurrentFamily | null) => setFamilyName(family?.name || ''))
      .catch(() => setFamilyName(''));
  }, [pathname]);

  useEffect(() => {
    const currentUserId = getCurrentUserId();
    setIsLoggedIn(!!currentUserId);
    if (!currentUserId) {
      setIsChildOnly(false);
      return;
    }

    api
      .get(`/users/${currentUserId}`)
      .then((user: SessionUser) => {
        const isChild = user.role === 'child';
        setIsChildOnly(isChild);
        if (isChild && pathname !== '/child') {
          router.replace('/child');
        }
      })
      .catch(() => {
        setIsChildOnly(false);
        setIsLoggedIn(false);
      });
  }, [pathname, router]);

  useEffect(() => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => logout(), INACTIVITY_MS);
    };

    const onActivity = () => resetTimer();
    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    for (const eventName of events) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onActivity);
    resetTimer();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      for (const eventName of events) {
        window.removeEventListener(eventName, onActivity);
      }
      document.removeEventListener('visibilitychange', onActivity);
    };
  }, [logout, pathname]);

  if (isChildOnly && pathname !== '/child') {
    return null;
  }

  return (
    <main className="container app-shell">
      {pathname !== '/' && (
        <header className="app-header">
          <div className="header">
            <Link className="site-brand" href="/">
              <h1 className="site-title">Chorly</h1>
              {familyName && <p className="site-family">{familyName}</p>}
            </Link>
            {isLoggedIn && (
              <button type="button" className="ghost-button logout-button" onClick={logout}>
                Log out
              </button>
            )}
          </div>
        </header>
      )}
      {children}
    </main>
  );
}
