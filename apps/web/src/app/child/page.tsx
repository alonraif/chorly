'use client';

import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { getCurrentUserId } from '../../lib/user';

type InstanceStatus = 'assigned' | 'done' | 'approved';
type ViewMode = 'list' | 'calendar';

type User = {
  id: string;
  displayName: string;
  isAdmin: boolean;
  isActive: boolean;
};

type Instance = {
  id: string;
  dueAt: string;
  status: InstanceStatus;
  chore: { title_en: string; title_he: string };
  doneByUserId: Record<string, { doneAt: string; undoneAt: string | null }>;
};

type Earnings = {
  userId: string;
  currencyCode: string;
  earnedTotal: string;
  paidOutTotal: string;
  dueAmount: string;
  earnEntries: Array<{
    id: string;
    amount: string;
    createdAt: string;
    instanceId: string | null;
    choreTitleEn: string | null;
    choreTitleHe: string | null;
    dueAt: string | null;
  }>;
  payoutEntries: Array<{
    id: string;
    amount: string;
    createdAt: string;
  }>;
};

function statusLabel(status: InstanceStatus) {
  if (status === 'approved') return 'Approved';
  if (status === 'done') return 'Done';
  return 'Assigned';
}

function dayLabel(dayIso: string) {
  return DateTime.fromISO(dayIso).toFormat('EEE, LLL d');
}

function money(amount: string, currencyCode: string) {
  const value = Number(amount || '0');
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(Number.isFinite(value) ? value : 0);
}

export default function ChildPage() {
  const currentUser = getCurrentUserId();

  const [actor, setActor] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [items, setItems] = useState<Instance[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showMoneyDetails, setShowMoneyDetails] = useState(false);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    const start = DateTime.now().setZone('Asia/Jerusalem').startOf('day');
    const end = start.plus({ days: 6 }).endOf('day');
    return {
      from: start.toUTC().toISO(),
      to: end.toUTC().toISO(),
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    setError('');
    Promise.all([api.get(`/users/${currentUser}`), api.get('/users')])
      .then(([me, allUsers]) => {
        const meTyped = me as User;
        const allTyped = allUsers as User[];
        setActor(meTyped);
        setUsers(allTyped.filter((u) => u.isActive));
        if (meTyped.isAdmin) {
          const firstChild = allTyped.find((u) => !u.isAdmin && u.isActive);
          setTargetUserId(firstChild?.id || meTyped.id);
        } else {
          setTargetUserId(meTyped.id);
        }
      })
      .catch((e) => setError(e.message || 'Failed to load session'));
  }, [currentUser]);

  async function loadData(userId: string) {
    if (!userId) return;
    setError('');
    try {
      const [instancesData, earningsData] = await Promise.all([
        api.get(`/instances?from=${encodeURIComponent(range.from || '')}&to=${encodeURIComponent(range.to || '')}&userId=${userId}`),
        api.get(`/users/${userId}/earnings`),
      ]);
      setItems(instancesData);
      setEarnings(earningsData);
    } catch (e: any) {
      setError(e.message || 'Failed to load child data');
    }
  }

  useEffect(() => {
    loadData(targetUserId);
  }, [targetUserId, range.from, range.to]);

  const dayKeys = useMemo(() => {
    const start = DateTime.fromISO(range.from || '').startOf('day');
    return Array.from({ length: 7 }, (_, index) => start.plus({ days: index }).toISODate() || '');
  }, [range.from]);

  const groupedByDay = useMemo(() => {
    const grouped: Record<string, Instance[]> = {};
    for (const day of dayKeys) grouped[day] = [];
    for (const item of items) {
      const day = DateTime.fromISO(item.dueAt).toISODate() || '';
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(item);
    }
    return grouped;
  }, [items, dayKeys]);

  async function toggleDone(instance: Instance) {
    if (!currentUser) return;
    const mine = instance.doneByUserId[currentUser];
    const done = !!mine && !mine.undoneAt;
    try {
      if (done) {
        await api.post(`/instances/${instance.id}/undo`, {});
      } else {
        await api.post(`/instances/${instance.id}/mark-done`, {});
      }
      await loadData(targetUserId);
    } catch (e: any) {
      setError(e.message || 'Failed to update status');
    }
  }

  async function payoutReset() {
    if (!targetUserId) return;
    try {
      await api.post(`/users/${targetUserId}/payout-reset`, {});
      await loadData(targetUserId);
    } catch (e: any) {
      setError(e.message || 'Failed to reset payout');
    }
  }

  const canUpdateCompletion = !!currentUser && currentUser === targetUserId;
  const canResetPayout = !!actor?.isAdmin && !!earnings && Number(earnings.dueAmount) > 0;

  return (
    <div className="parent-view">
      <section className="card">
        <div className="page-title">
          <h2>Child Chorespace</h2>
          <p className="lead">Weekly assigned chores, completion updates, and earned money tracking.</p>
        </div>

        {actor?.isAdmin && (
          <label>
            Child
            <select value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)}>
              {users.filter((u) => !u.isAdmin).map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </select>
          </label>
        )}

        {earnings && (
          <div className="card wallet-card">
            <button
              type="button"
              className="wallet-total"
              onClick={() => setShowMoneyDetails((v) => !v)}
            >
              Amount due: {money(earnings.dueAmount, earnings.currencyCode)}
            </button>
            <small className="task-meta">
              Earned total: {money(earnings.earnedTotal, earnings.currencyCode)} • Paid out: {money(earnings.paidOutTotal, earnings.currencyCode)}
            </small>

            {showMoneyDetails && (
              <ul className="list compact">
                {earnings.earnEntries.map((entry) => (
                  <li key={entry.id}>
                    <p className="task-title">{entry.choreTitleHe || '-'} / {entry.choreTitleEn || '-'}</p>
                    <small className="task-meta">
                      {money(entry.amount, earnings.currencyCode)} • {entry.dueAt ? DateTime.fromISO(entry.dueAt).setZone('Asia/Jerusalem').toFormat('LLL d, HH:mm') : DateTime.fromISO(entry.createdAt).toFormat('LLL d, HH:mm')}
                    </small>
                  </li>
                ))}
                {earnings.earnEntries.length === 0 && <li><p className="lead">No paid chores yet.</p></li>}
              </ul>
            )}

            {canResetPayout && (
              <button type="button" onClick={payoutReset}>Mark amount as transferred</button>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="week-header">
          <h3>Assigned This Week</h3>
          <div className="view-toggle" role="tablist" aria-label="View mode">
            <button
              type="button"
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
            <button
              type="button"
              className={viewMode === 'calendar' ? 'active' : ''}
              onClick={() => setViewMode('calendar')}
            >
              Calendar
            </button>
          </div>
        </div>

        {!currentUser && <p className="lead">Select a user first.</p>}
        {!canUpdateCompletion && currentUser && <p className="lead">To update completion, switch to this child user in the user switcher.</p>}
        {error && <p className="error">{error}</p>}

        {viewMode === 'list' && (
          <div className="list-week">
            {dayKeys.map((day) => (
              <section key={day} className="day-list">
                <h4>{dayLabel(day)}</h4>
                {groupedByDay[day]?.length ? (
                  <ul className="list compact">
                    {groupedByDay[day].map((item) => {
                      const mine = currentUser ? item.doneByUserId[currentUser] : undefined;
                      const done = !!mine && !mine.undoneAt;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="task-click"
                            onClick={() => toggleDone(item)}
                            disabled={!canUpdateCompletion}
                            title={canUpdateCompletion ? 'Toggle completion' : 'Switch to child user to update'}
                          >
                            <div className="task-row">
                              <div>
                                <p className="task-title">{item.chore.title_he} / {item.chore.title_en}</p>
                                <small className="task-meta">
                                  {DateTime.fromISO(item.dueAt).setZone('Asia/Jerusalem').toFormat('HH:mm')} • {done ? 'Done by you' : statusLabel(item.status)}
                                </small>
                              </div>
                              <span className={`status-badge status-${done ? 'done' : item.status}`}>{done ? 'Done by you' : statusLabel(item.status)}</span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="lead">No chores scheduled.</p>
                )}
              </section>
            ))}
          </div>
        )}

        {viewMode === 'calendar' && (
          <div className="calendar-grid">
            {dayKeys.map((day) => (
              <section key={day} className="calendar-day">
                <h4>{dayLabel(day)}</h4>
                {groupedByDay[day]?.length ? (
                  <ul className="list compact">
                    {groupedByDay[day].map((item) => {
                      const mine = currentUser ? item.doneByUserId[currentUser] : undefined;
                      const done = !!mine && !mine.undoneAt;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="task-click"
                            onClick={() => toggleDone(item)}
                            disabled={!canUpdateCompletion}
                            title={canUpdateCompletion ? 'Toggle completion' : 'Switch to child user to update'}
                          >
                            <p className="task-title">{item.chore.title_he} / {item.chore.title_en}</p>
                            <small className="task-meta">
                              {DateTime.fromISO(item.dueAt).setZone('Asia/Jerusalem').toFormat('HH:mm')} • {done ? 'Done by you' : statusLabel(item.status)}
                            </small>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="lead">No chores</p>
                )}
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
