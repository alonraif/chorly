'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { clearCurrentLocale, clearCurrentUserId, getCurrentUserId } from '../lib/user';
import { NotificationsButton } from './notifications-button';

type CurrentFamily = {
  id: string;
  name: string;
  defaultLocale: 'en' | 'he';
};

type SessionUser = {
  id: string;
  role: 'parent' | 'child';
};

export function AppFrame({ children }: { children: ReactNode }) {
  const [familyName, setFamilyName] = useState('');
  const [isChildOnly, setIsChildOnly] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    clearCurrentUserId();
    clearCurrentLocale();
    setIsChildOnly(false);
    setIsLoggedIn(false);
    router.replace('/');
  }, [router]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!getCurrentUserId() || pathname === '/' || pathname === '/register') {
      setIsLoggedIn(false);
      setFamilyName('');
      return;
    }

    api
      .get('/auth/me')
      .then((user: SessionUser) => {
        setIsLoggedIn(true);
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

    api
      .get('/family/current')
      .then((family: CurrentFamily | null) => setFamilyName(family?.name || ''))
      .catch(() => setFamilyName(''));
  }, [pathname, router]);

  if (isChildOnly && pathname !== '/child') {
    return null;
  }

  return (
    <main className="container app-shell">
      {pathname !== '/' && (
        <header className="app-header">
          <div className="header">
            <Link className="site-brand" href={isChildOnly ? '/child' : '/parent'}>
              <h1 className="site-title">Chorly</h1>
              {familyName && <p className="site-family">{familyName}</p>}
            </Link>
            {isLoggedIn && (
              <div className="action-row">
                <NotificationsButton />
                <button type="button" className="ghost-button logout-button" onClick={logout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </header>
      )}
      {children}
    </main>
  );
}
