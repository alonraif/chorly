'use client';

import Link from 'next/link';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type InstanceStatus = 'assigned' | 'done' | 'approved';

type Instance = {
  id: string;
  choreId: string;
  dueAt: string;
  status: InstanceStatus;
  chore: { title_en: string; title_he: string };
  assignments: Array<{ userId: string; displayName: string }>;
};

type ViewMode = 'list' | 'calendar';

function statusLabel(status: InstanceStatus) {
  if (status === 'approved') return 'Approved';
  if (status === 'done') return 'Done';
  return 'Assigned';
}

function dayLabel(dayIso: string) {
  return DateTime.fromISO(dayIso).toFormat('EEE, LLL d');
}

export default function ParentPage() {
  const [items, setItems] = useState<Instance[]>([]);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const range = useMemo(() => {
    const now = DateTime.now().setZone('Asia/Jerusalem').startOf('day');
    return {
      from: now.toUTC().toISO(),
      to: now.plus({ days: 6 }).endOf('day').toUTC().toISO(),
    };
  }, []);

  async function load() {
    try {
      const data = await api.get(`/instances?from=${encodeURIComponent(range.from || '')}&to=${encodeURIComponent(range.to || '')}`);
      setItems(data);
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => {
    load();
  }, [range.from, range.to]);

  async function onDeleteOccurrence(instanceId: string) {
    const ok = window.confirm('Delete this chore occurrence?');
    if (!ok) return;
    setError('');
    try {
      await api.delete(`/instances/${instanceId}`);
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to delete occurrence');
    }
  }

  async function onDeleteRecurring(choreId: string) {
    const ok = window.confirm('Delete this recurring chore and remove upcoming unapproved occurrences?');
    if (!ok) return;
    setError('');
    try {
      await api.delete(`/chores/${choreId}`);
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to delete recurring chore');
    }
  }

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

  return (
    <div className="parent-view">
      <section className="card">
        <div className="page-title">
          <h2>Parent Chorespace</h2>
          <p className="lead">Plan and track the upcoming week across all assigned chores in your family.</p>
        </div>

        <h3>Quick Actions</h3>
        <div className="action-row">
          <Link className="button-link" href="/admin/chores#new-chore">Create chore</Link>
          <Link className="button-link" href="/admin/chores#new-chore">Assign chore</Link>
          <Link className="button-link" href="/admin/chores#active-chores">Edit chore</Link>
        </div>

        <details className="admin-dropdown">
          <summary>Admin</summary>
          <div className="admin-links">
            <Link href="/parent/review">Approve completed chores</Link>
            <Link href="/admin/family">Family members and invites</Link>
            <Link href="/admin/users">User management</Link>
            <Link href="/admin/chores">Full chore admin</Link>
          </div>
        </details>
      </section>

      <section className="card">
        <div className="week-header">
          <h3>Upcoming Week</h3>
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

        {error && <p className="error">{error}</p>}

        {viewMode === 'list' && (
          <div className="list-week">
            {dayKeys.map((day) => (
              <section key={day} className="day-list">
                <h4>{dayLabel(day)}</h4>
                {groupedByDay[day]?.length ? (
                  <ul className="list compact">
                    {groupedByDay[day].map((item) => (
                      <li key={item.id} className="task-row">
                        <div>
                          <p className="task-title">{item.chore.title_he} / {item.chore.title_en}</p>
                          <small className="task-meta">
                            {DateTime.fromISO(item.dueAt).setZone('Asia/Jerusalem').toFormat('HH:mm')} • {item.assignments.map((a) => a.displayName).join(', ')}
                          </small>
                          <div className="action-row">
                            <button type="button" className="ghost-button" onClick={() => onDeleteOccurrence(item.id)}>Delete occurrence</button>
                            <button type="button" className="ghost-button" onClick={() => onDeleteRecurring(item.choreId)}>Delete recurring chore</button>
                          </div>
                        </div>
                        <span className={`status-badge status-${item.status}`}>{statusLabel(item.status)}</span>
                      </li>
                    ))}
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
                    {groupedByDay[day].map((item) => (
                      <li key={item.id}>
                        <p className="task-title">{item.chore.title_he} / {item.chore.title_en}</p>
                        <small className="task-meta">
                          {DateTime.fromISO(item.dueAt).setZone('Asia/Jerusalem').toFormat('HH:mm')} • {statusLabel(item.status)}
                        </small>
                        <div className="action-row">
                          <button type="button" className="ghost-button" onClick={() => onDeleteOccurrence(item.id)}>Delete occurrence</button>
                          <button type="button" className="ghost-button" onClick={() => onDeleteRecurring(item.choreId)}>Delete recurring chore</button>
                        </div>
                      </li>
                    ))}
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
