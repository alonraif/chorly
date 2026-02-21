'use client';

import Link from 'next/link';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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

type User = {
  id: string;
  displayName: string;
  role: 'parent' | 'child';
  isActive: boolean;
};

type ChoreDefinition = {
  id: string;
  scheduleJson: { type: 'one_time' | 'repeating_calendar' | 'repeating_after_completion' };
};

type ViewMode = 'list' | 'calendar';

type OccurrenceEditorState = {
  instanceId: string;
  choreId: string;
  dueAtLocal: string;
  assigneeUserId: string;
  choreTitle: string;
};

type EditChoiceState = {
  instanceId: string;
  choreId: string;
  dueAt: string;
  choreTitle: string;
  assigneeUserId: string;
};

function statusLabel(status: InstanceStatus) {
  if (status === 'approved') return 'Approved';
  if (status === 'done') return 'Done';
  return 'Assigned';
}

function dayLabel(dayIso: string) {
  return DateTime.fromISO(dayIso).toFormat('EEE, LLL d');
}

export default function ParentPage() {
  const router = useRouter();
  const [items, setItems] = useState<Instance[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [occurrenceEditor, setOccurrenceEditor] = useState<OccurrenceEditorState | null>(null);
  const [editChoice, setEditChoice] = useState<EditChoiceState | null>(null);

  const range = useMemo(() => {
    const now = DateTime.now().setZone('Asia/Jerusalem').startOf('day');
    return {
      from: now.toUTC().toISO(),
      to: now.plus({ days: 6 }).endOf('day').toUTC().toISO(),
    };
  }, []);

  async function load() {
    try {
      const [instancesData, usersData] = await Promise.all([
        api.get(`/instances?from=${encodeURIComponent(range.from || '')}&to=${encodeURIComponent(range.to || '')}`),
        api.get('/users'),
      ]);
      setItems(instancesData);
      setUsers((usersData as User[]).filter((user) => user.role === 'child' && user.isActive));
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => {
    load();
  }, [range.from, range.to]);

  function toLocalDatetimeInput(iso: string) {
    return DateTime.fromISO(iso).setZone('Asia/Jerusalem').toFormat("yyyy-LL-dd'T'HH:mm");
  }

  async function onEdit(item: Instance) {
    setError('');
    try {
      const chore = await api.get(`/chores/${item.choreId}`) as ChoreDefinition;
      const isRecurring = chore.scheduleJson.type !== 'one_time';
      const currentAssignee = item.assignments[0]?.userId || users[0]?.id || '';
      if (isRecurring) {
        setEditChoice({
          instanceId: item.id,
          choreId: item.choreId,
          dueAt: item.dueAt,
          choreTitle: `${item.chore.title_he} / ${item.chore.title_en}`,
          assigneeUserId: currentAssignee,
        });
        return;
      }

      setOccurrenceEditor({
        instanceId: item.id,
        choreId: item.choreId,
        dueAtLocal: toLocalDatetimeInput(item.dueAt),
        assigneeUserId: currentAssignee,
        choreTitle: `${item.chore.title_he} / ${item.chore.title_en}`,
      });
    } catch (e: any) {
      setError(e.message || 'Failed to open chore editor');
    }
  }

  function openOccurrenceEditorFromChoice() {
    if (!editChoice) return;
    setOccurrenceEditor({
      instanceId: editChoice.instanceId,
      choreId: editChoice.choreId,
      dueAtLocal: toLocalDatetimeInput(editChoice.dueAt),
      assigneeUserId: editChoice.assigneeUserId,
      choreTitle: editChoice.choreTitle,
    });
    setEditChoice(null);
  }

  async function saveOccurrenceEdit() {
    if (!occurrenceEditor) return;
    if (!occurrenceEditor.assigneeUserId) {
      setError('Please select an assignee.');
      return;
    }
    try {
      await api.patch(`/instances/${occurrenceEditor.instanceId}`, {
        dueAt: new Date(occurrenceEditor.dueAtLocal).toISOString(),
        assigneeUserId: occurrenceEditor.assigneeUserId,
      });
      setOccurrenceEditor(null);
      await load();
    } catch (e: any) {
      setError(e.message || 'Failed to update occurrence');
    }
  }

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
                            <button type="button" className="ghost-button" onClick={() => onEdit(item)}>Edit chore</button>
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
                          <button type="button" className="ghost-button" onClick={() => onEdit(item)}>Edit chore</button>
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

      {occurrenceEditor && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-occurrence-title">
          <div className="modal-card">
            <h3 id="edit-occurrence-title">Edit occurrence</h3>
            <p>{occurrenceEditor.choreTitle}</p>
            <label>
              Due date/time
              <input
                type="datetime-local"
                value={occurrenceEditor.dueAtLocal}
                onChange={(e) => setOccurrenceEditor((prev) => (prev ? { ...prev, dueAtLocal: e.target.value } : prev))}
              />
            </label>
            <label>
              Assignee
              <select
                value={occurrenceEditor.assigneeUserId}
                onChange={(e) => setOccurrenceEditor((prev) => (prev ? { ...prev, assigneeUserId: e.target.value } : prev))}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.displayName}</option>
                ))}
              </select>
            </label>
            <div className="action-row">
              <button type="button" onClick={saveOccurrenceEdit}>Save</button>
              <button type="button" className="ghost-button" onClick={() => setOccurrenceEditor(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editChoice && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-choice-title">
          <div className="modal-card">
            <h3 id="edit-choice-title">Edit recurring chore</h3>
            <p>{editChoice.choreTitle}</p>
            <div className="action-row">
              <button type="button" onClick={openOccurrenceEditorFromChoice}>Edit occurrence</button>
              <button
                type="button"
                onClick={() => {
                  setEditChoice(null);
                  router.push(`/admin/chores?edit=series&choreId=${encodeURIComponent(editChoice.choreId)}`);
                }}
              >
                Edit series
              </button>
              <button type="button" className="ghost-button" onClick={() => setEditChoice(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
