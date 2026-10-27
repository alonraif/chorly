'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { t, type MessageKey } from '../lib/i18n';
import { SessionProvider, useSession, type Member } from '../lib/session';
import { clearCurrentUserId, setCurrentLocale } from '../lib/user';
import { Avatar } from './avatar';
import { Icon, type IconName } from './icon';
import { LanguageRow, PublicLanguageSwitch } from './language-picker';
import { NotificationsRow } from './notifications-button';
import { NotificationPrefsRow } from './notification-prefs';
import { Sheet, Spinner, UiProvider } from './ui';

const PUBLIC_PATHS = ['/', '/register'];

const PARENT_NAV: Array<{ href: string; label: MessageKey; icon: IconName; badge?: boolean }> = [
  { href: '/parent', label: 'nav.home', icon: 'home' },
  { href: '/parent/review', label: 'nav.approvals', icon: 'approve', badge: true },
  { href: '/admin/chores', label: 'nav.chores', icon: 'list' },
  { href: '/admin/users', label: 'nav.family', icon: 'users' },
];

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const [me, setMe] = useState<Member | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (isPublic) {
      setMe(null);
      return;
    }
    api
      .get('/auth/me')
      .then((user: Member) => {
        // Switches the whole UI to this member's language (remounts if it changed).
        setCurrentLocale(user.locale);
        setMe(user);
      })
      .catch(() => router.replace('/'));
    // Only re-check when moving between public and signed-in areas.
  }, [isPublic, router]);

  const isChild = me?.role === 'child';
  useEffect(() => {
    if (isChild && pathname !== '/child') router.replace('/child');
  }, [isChild, pathname, router]);

  if (isPublic) {
    return (
      <UiProvider>
        <main className="public-shell">
          <PublicLanguageSwitch />
          {children}
        </main>
      </UiProvider>
    );
  }

  if (!me || (isChild && pathname !== '/child')) {
    return (
      <div className="splash">
        <BrandMark />
        <Spinner />
      </div>
    );
  }

  return (
    <UiProvider>
      <SessionProvider me={me}>
        {isChild ? <KidShell>{children}</KidShell> : <ParentShell>{children}</ParentShell>}
      </SessionProvider>
    </UiProvider>
  );
}

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="check" size={Math.round(size * 0.6)} />
    </span>
  );
}

function useLogout() {
  const router = useRouter();
  return useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    clearCurrentUserId();
    router.replace('/');
  }, [router]);
}

function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, family } = useSession();
  const logout = useLogout();
  return (
    <Sheet open={open} onClose={onClose} title={t('account.title')} size="sm">
      <div className="account-head">
        <Avatar user={me} size={48} />
        <div>
          <p className="account-name">{me.displayName}</p>
          <p className="muted small">
            {me.role === 'parent' ? t('common.parent') : t('common.kid')}
            {family?.name ? ` · ${family.name}` : ''}
          </p>
        </div>
      </div>
      <div className="settings-list">
        <LanguageRow />
        <NotificationsRow />
        <NotificationPrefsRow />
        <button type="button" className="setting-row setting-button" onClick={logout}>
          <span className="setting-icon">
            <Icon name="logout" size={18} />
          </span>
          <span className="setting-text">
            <span className="setting-label">{t('account.logout')}</span>
            <span className="field-hint">{me.email}</span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}

function isActive(pathname: string, href: string) {
  if (href === '/parent') return pathname === '/parent';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ParentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { me, family, approvalsCount, refreshApprovals } = useSession();
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    refreshApprovals().catch(() => undefined);
  }, [pathname, refreshApprovals]);

  return (
    <div className="parent-shell">
      <aside className="sidebar">
        <Link href="/parent" className="sidebar-brand">
          <BrandMark />
          <span>
            <span className="brand-name">Chorly</span>
            {family?.name && <span className="brand-family">{family.name}</span>}
          </span>
        </Link>
        <nav className="sidebar-nav" aria-label={t('nav.main')}>
          {PARENT_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${isActive(pathname, item.href) ? 'is-active' : ''}`}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{t(item.label)}</span>
              {item.badge && approvalsCount > 0 && <span className="nav-badge">{approvalsCount}</span>}
            </Link>
          ))}
        </nav>
        <button type="button" className="sidebar-account" onClick={() => setAccountOpen(true)}>
          <Avatar user={me} size={32} />
          <span className="sidebar-account-name">{me.displayName}</span>
          <Icon name="more" size={18} />
        </button>
      </aside>

      <header className="topbar">
        <Link href="/parent" className="topbar-brand">
          <BrandMark size={28} />
          <span className="brand-name">{family?.name || 'Chorly'}</span>
        </Link>
        <button type="button" className="topbar-account" onClick={() => setAccountOpen(true)} aria-label={t('account.title')}>
          <Avatar user={me} size={32} />
        </button>
      </header>

      <main className="parent-main">{children}</main>

      <nav className="tabbar" aria-label={t('nav.main')}>
        {PARENT_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`tab ${isActive(pathname, item.href) ? 'is-active' : ''}`}
            aria-current={isActive(pathname, item.href) ? 'page' : undefined}
          >
            <span className="tab-icon">
              <Icon name={item.icon} size={22} />
              {item.badge && approvalsCount > 0 && <span className="nav-badge">{approvalsCount}</span>}
            </span>
            <span>{t(item.label)}</span>
          </Link>
        ))}
      </nav>

      <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}

function KidShell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [accountOpen, setAccountOpen] = useState(false);
  return (
    <div className="kid-shell">
      <header className="kid-topbar">
        <span className="topbar-brand">
          <BrandMark size={28} />
          <span className="brand-name">Chorly</span>
        </span>
        <button type="button" className="topbar-account" onClick={() => setAccountOpen(true)} aria-label={t('account.title')}>
          <Avatar user={me} size={36} />
        </button>
      </header>
      <main className="kid-main">{children}</main>
      <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
