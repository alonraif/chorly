'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { now, type Locale } from './format';
import { setCurrentLocale, setCurrentUserId } from './user';

export type Member = {
  id: string;
  email: string | null;
  displayName: string;
  role: 'parent' | 'child';
  isAdmin: boolean;
  locale: Locale;
  isActive: boolean;
  isAway: boolean;
};

export type Family = { id: string; name: string; defaultLocale: Locale; currencyCode?: string };

type SessionValue = {
  me: Member;
  family: Family | null;
  members: Member[];
  kids: Member[];
  currency: string;
  approvalsCount: number;
  refreshMembers: () => Promise<void>;
  refreshApprovals: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function approvalsRange() {
  const today = now();
  return {
    from: today.minus({ days: 30 }).startOf('day').toUTC().toISO() || '',
    to: today.plus({ days: 7 }).endOf('day').toUTC().toISO() || '',
  };
}

export function SessionProvider({ me, children }: { me: Member; children: ReactNode }) {
  const [family, setFamily] = useState<Family | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [approvalsCount, setApprovalsCount] = useState(0);

  const refreshMembers = useCallback(async () => {
    const users = (await api.get('/users')) as Member[];
    setMembers(users.filter((u) => u.isActive));
  }, []);

  const refreshApprovals = useCallback(async () => {
    if (!me.isAdmin) return;
    const { from, to } = approvalsRange();
    const items = (await api.get(`/instances?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)) as Array<{ status: string }>;
    setApprovalsCount(items.filter((i) => i.status === 'done').length);
  }, [me.isAdmin]);

  useEffect(() => {
    setCurrentUserId(me.id);
    setCurrentLocale(me.locale);
    api.get('/family/current').then(setFamily).catch(() => setFamily(null));
    refreshMembers().catch(() => undefined);
    refreshApprovals().catch(() => undefined);
  }, [me.id, me.locale, refreshMembers, refreshApprovals]);

  const kids = useMemo(() => members.filter((m) => m.role === 'child'), [members]);

  return (
    <SessionContext.Provider
      value={{
        me,
        family,
        members,
        kids,
        currency: family?.currencyCode || 'ILS',
        approvalsCount,
        refreshMembers,
        refreshApprovals,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
