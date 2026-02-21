'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';

type User = { id: string; displayName: string; role: 'parent' | 'child' };
type SuccessSummary = { title: string; scheduleLabel: string; assignees: string; shared: boolean; favorite: boolean };
type ExistingChore = {
  id: string;
  title_en: string;
  title_he: string;
  hasReward: boolean;
  rewardAmount: string | null;
  scheduleJson: any;
  assignmentJson: any;
};

const REPEATING_CALENDAR_OPTIONS = [
  { label: 'Every day', value: 'FREQ=DAILY' },
  { label: 'Every Sunday', value: 'FREQ=WEEKLY;BYDAY=SU' },
  { label: 'Every Monday', value: 'FREQ=WEEKLY;BYDAY=MO' },
  { label: 'Every Tuesday', value: 'FREQ=WEEKLY;BYDAY=TU' },
  { label: 'Every Wednesday', value: 'FREQ=WEEKLY;BYDAY=WE' },
  { label: 'Every Thursday', value: 'FREQ=WEEKLY;BYDAY=TH' },
  { label: 'Every Friday', value: 'FREQ=WEEKLY;BYDAY=FR' },
  { label: 'Every Saturday', value: 'FREQ=WEEKLY;BYDAY=SA' },
  { label: 'First Sunday of every month', value: 'FREQ=MONTHLY;BYDAY=1SU' },
  { label: 'First Monday of every month', value: 'FREQ=MONTHLY;BYDAY=1MO' },
  { label: 'Last Sunday of every month', value: 'FREQ=MONTHLY;BYDAY=-1SU' },
] as const;

export default function AdminChoresPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');

  const [titleEngHe, setTitleEngHe] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [scheduleType, setScheduleType] = useState<'one_time' | 'repeating_calendar' | 'repeating_after_completion'>('repeating_calendar');
  const [oneTimeDueAt, setOneTimeDueAt] = useState('');
  const [rrule, setRrule] = useState<string>(REPEATING_CALENDAR_OPTIONS[1].value);
  const [intervalDays, setIntervalDays] = useState(2);
  const [recurrenceEndMode, setRecurrenceEndMode] = useState<'indefinite' | 'end_date'>('indefinite');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [dueTime, setDueTime] = useState('20:00');
  const [grace, setGrace] = useState(60);
  const [shared, setShared] = useState(false);
  const [sharedAssigneeIds, setSharedAssigneeIds] = useState<string[]>([]);
  const [skipAwayUsers, setSkipAwayUsers] = useState(true);
  const [hasReward, setHasReward] = useState(false);
  const [rewardAmount, setRewardAmount] = useState('');
  const [addToFavorites, setAddToFavorites] = useState(false);
  const [successSummary, setSuccessSummary] = useState<SuccessSummary | null>(null);
  const [editChoreId, setEditChoreId] = useState<string | null>(null);
  const assignableUsers = useMemo(() => users.filter((user) => user.role === 'child'), [users]);

  async function loadUsers() {
    try {
      const u = await api.get('/users');
      setUsers(u);
      const firstAssignable = u.find((user: User) => user.role === 'child');
      if (!assigneeId && firstAssignable) {
        setAssigneeId(firstAssignable.id);
      }
      if (sharedAssigneeIds.length === 0 && firstAssignable) {
        setSharedAssigneeIds([firstAssignable.id]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    }
  }

  async function loadChoreForEdit(choreId: string) {
    const chore = await api.get(`/chores/${choreId}`) as ExistingChore;
    const schedule = chore.scheduleJson || {};
    const assignment = chore.assignmentJson || {};
    setEditChoreId(chore.id);
    setTitleEngHe(chore.title_en || chore.title_he || '');
    setHasReward(!!chore.hasReward);
    setRewardAmount(chore.rewardAmount || '');
    setShared(!!assignment.shared);
    const nextAssignees = Array.isArray(assignment.assigneeIds) ? assignment.assigneeIds : [];
    setSharedAssigneeIds(nextAssignees);
    setAssigneeId(nextAssignees[0] || '');
    setSkipAwayUsers(assignment.skipAwayUsers ?? true);

    if (schedule.type === 'one_time') {
      setScheduleType('one_time');
      setOneTimeDueAt(schedule.oneTimeDueAt ? new Date(schedule.oneTimeDueAt).toISOString().slice(0, 16) : '');
    } else if (schedule.type === 'repeating_after_completion') {
      setScheduleType('repeating_after_completion');
      setIntervalDays(schedule.intervalDays ?? 1);
      setDueTime(schedule.dueTime || '20:00');
    } else {
      setScheduleType('repeating_calendar');
      setRrule(schedule.rrule || REPEATING_CALENDAR_OPTIONS[0].value);
      setDueTime(schedule.dueTime || '20:00');
    }

    if (schedule.endsAt) {
      setRecurrenceEndMode('end_date');
      setRecurrenceEndDate(new Date(schedule.endsAt).toISOString().slice(0, 10));
    } else {
      setRecurrenceEndMode('indefinite');
      setRecurrenceEndDate('');
    }
    setGrace(schedule.gracePeriodMinutes ?? 60);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const editMode = query.get('edit');
    const choreId = query.get('choreId');
    if (editMode === 'series' && choreId) {
      loadChoreForEdit(choreId).catch((err: any) => setError(err.message || 'Failed to load chore'));
      return;
    }
    setEditChoreId(null);
  }, []);
  useEffect(() => {
    if (!assigneeId) return;
    setSharedAssigneeIds((prev) => (prev.includes(assigneeId) ? prev : [...prev, assigneeId]));
  }, [assigneeId]);
  useEffect(() => {
    const assignableIds = new Set(assignableUsers.map((user) => user.id));
    if (assigneeId && !assignableIds.has(assigneeId)) {
      setAssigneeId(assignableUsers[0]?.id || '');
    }
    setSharedAssigneeIds((prev) => {
      const next = prev.filter((id) => assignableIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [assigneeId, assignableUsers]);

  function buildSchedule() {
    const endsAt = recurrenceEndMode === 'end_date' && recurrenceEndDate
      ? new Date(`${recurrenceEndDate}T23:59:59`).toISOString()
      : undefined;
    if (scheduleType === 'one_time') {
      return { type: 'one_time', oneTimeDueAt: new Date(oneTimeDueAt).toISOString(), gracePeriodMinutes: grace };
    }
    if (scheduleType === 'repeating_calendar') {
      return { type: 'repeating_calendar', rrule, dueTime: dueTime || undefined, endsAt, gracePeriodMinutes: grace };
    }
    return { type: 'repeating_after_completion', intervalDays, dueTime: dueTime || undefined, endsAt, gracePeriodMinutes: grace };
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const effectiveAssigneeIds = shared
        ? Array.from(new Set([assigneeId, ...sharedAssigneeIds])).filter(Boolean)
        : assigneeId ? [assigneeId] : [];
      const payload = {
        title_en: titleEngHe,
        title_he: titleEngHe,
        hasReward,
        rewardAmount: hasReward ? rewardAmount : undefined,
        allowNotes: true,
        allowPhotoProof: false,
        schedule: buildSchedule(),
        assignment: { shared, mode: shared ? 'round_robin' : 'fixed', skipAwayUsers, assigneeIds: effectiveAssigneeIds },
      };
      if (editChoreId) {
        await api.patch(`/chores/${editChoreId}`, payload);
        router.push('/parent');
        return;
      }
      await api.post('/chores', payload);
      if (addToFavorites) {
        await api.post('/templates', payload);
      }
      const chosenAssignees = (shared ? sharedAssigneeIds : [assigneeId])
        .map((id) => users.find((user) => user.id === id)?.displayName)
        .filter(Boolean)
        .join(', ');
      const scheduleLabel = scheduleType === 'one_time'
        ? 'One time'
        : scheduleType === 'repeating_calendar'
          ? (REPEATING_CALENDAR_OPTIONS.find((opt) => opt.value === rrule)?.label || 'Repeating calendar')
          : `Every ${intervalDays} day(s) after completion`;
      const scheduleWithEnd = scheduleType === 'one_time'
        ? scheduleLabel
        : recurrenceEndMode === 'end_date' && recurrenceEndDate
        ? `${scheduleLabel} (until ${recurrenceEndDate})`
        : `${scheduleLabel} (indefinite)`;
      setSuccessSummary({
        title: titleEngHe,
        scheduleLabel: scheduleWithEnd,
        assignees: chosenAssignees || 'None',
        shared,
        favorite: addToFavorites,
      });
      setTitleEngHe('');
      await loadUsers();
    } catch (err: any) {
      setError(err.message || 'Failed to create chore');
    }
  }

  return (
    <div>
      <div className="page-title">
        <h2>{editChoreId ? 'Edit chore series' : 'Create and asign chore'}</h2>
        <p className="lead">{editChoreId ? 'Update chore schedule and assignment for the entire series.' : 'Create chores, configure schedules, and assign them to kids.'}</p>
      </div>
      {error && <p className="error">{error}</p>}

      <form id="new-chore" className="card form-grid" onSubmit={onCreate}>
        <label>Title
          <input value={titleEngHe} onChange={(e) => setTitleEngHe(e.target.value)} required />
        </label>

        <label>Assignee
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} required>
            {assignableUsers.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
          </select>
        </label>
        {assignableUsers.length === 0 && <p className="error form-full">No child users available for assignment.</p>}

        <label>Schedule type
          <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as any)}>
            <option value="one_time">One time</option>
            <option value="repeating_calendar">Repeating calendar</option>
            <option value="repeating_after_completion">Repeating after completion</option>
          </select>
        </label>

        {scheduleType === 'one_time' && (
          <label>One-time due
            <input type="datetime-local" value={oneTimeDueAt} onChange={(e) => setOneTimeDueAt(e.target.value)} required />
          </label>
        )}
        {scheduleType === 'repeating_calendar' && (
          <label>Repeat
            <select value={rrule} onChange={(e) => setRrule(e.target.value)}>
              {REPEATING_CALENDAR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
        {scheduleType === 'repeating_after_completion' && (
          <label>Interval days
            <input type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(Number(e.target.value))} />
          </label>
        )}

        {scheduleType !== 'one_time' && (
          <label>Due time
            <input value={dueTime} onChange={(e) => setDueTime(e.target.value)} placeholder="20:00" />
          </label>
        )}

        {scheduleType !== 'one_time' && (
          <label>Recurrence end
            <select value={recurrenceEndMode} onChange={(e) => setRecurrenceEndMode(e.target.value as 'indefinite' | 'end_date')}>
              <option value="indefinite">Indefinite</option>
              <option value="end_date">End date</option>
            </select>
          </label>
        )}
        {scheduleType !== 'one_time' && recurrenceEndMode === 'end_date' && (
          <label>End date
            <input type="date" value={recurrenceEndDate} onChange={(e) => setRecurrenceEndDate(e.target.value)} required />
          </label>
        )}

        <label>Grace minutes
          <input type="number" min={0} value={grace} onChange={(e) => setGrace(Number(e.target.value))} />
        </label>

        <label className="checkbox-row">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Shared chore
        </label>

        {shared && (
          <fieldset className="checkbox-list">
            <legend>Kids sharing this task</legend>
            {assignableUsers.map((user) => (
              <label key={user.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={sharedAssigneeIds.includes(user.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSharedAssigneeIds((prev) => Array.from(new Set([...prev, user.id])));
                      return;
                    }
                    setSharedAssigneeIds((prev) => prev.filter((id) => id !== user.id));
                  }}
                />
                {user.displayName}
              </label>
            ))}
          </fieldset>
        )}

        <label className="checkbox-row">
          <input type="checkbox" checked={skipAwayUsers} onChange={(e) => setSkipAwayUsers(e.target.checked)} />
          Skip away users
        </label>

        <label className="checkbox-row">
          <input type="checkbox" checked={hasReward} onChange={(e) => setHasReward(e.target.checked)} />
          Has reward
        </label>
        {hasReward && <input placeholder="Reward amount" value={rewardAmount} onChange={(e) => setRewardAmount(e.target.value)} />}

        <label className="checkbox-row">
          <input type="checkbox" checked={addToFavorites} onChange={(e) => setAddToFavorites(e.target.checked)} />
          Add to favorites
        </label>

        <button type="submit">{editChoreId ? 'Save changes' : 'Create chore'}</button>
      </form>

      {successSummary && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="chore-created-title">
          <div className="modal-card">
            <h3 id="chore-created-title">Chore created successfully</h3>
            <p><strong>Title:</strong> {successSummary.title || '-'}</p>
            <p><strong>Schedule:</strong> {successSummary.scheduleLabel}</p>
            <p><strong>Assignee(s):</strong> {successSummary.assignees}</p>
            <p><strong>Shared:</strong> {successSummary.shared ? 'Yes' : 'No'}</p>
            <p><strong>Saved to favorites:</strong> {successSummary.favorite ? 'Yes' : 'No'}</p>
            <button type="button" onClick={() => router.push('/chorespace')}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
