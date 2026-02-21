'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';

type User = { id: string; displayName: string };
type Chore = { id: string; title_en: string; title_he: string; hasReward: boolean; rewardAmount: string | null };

export default function AdminChoresPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [templates, setTemplates] = useState<Chore[]>([]);
  const [error, setError] = useState('');

  const [titleEn, setTitleEn] = useState('');
  const [titleHe, setTitleHe] = useState('');
  const [scheduleType, setScheduleType] = useState<'one_time' | 'repeating_calendar' | 'repeating_after_completion'>('repeating_calendar');
  const [oneTimeDueAt, setOneTimeDueAt] = useState('');
  const [rrule, setRrule] = useState('FREQ=WEEKLY;BYDAY=SU');
  const [intervalDays, setIntervalDays] = useState(2);
  const [dueTime, setDueTime] = useState('20:00');
  const [grace, setGrace] = useState(60);
  const [shared, setShared] = useState(false);
  const [mode, setMode] = useState<'fixed' | 'round_robin'>('fixed');
  const [skipAwayUsers, setSkipAwayUsers] = useState(true);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [hasReward, setHasReward] = useState(false);
  const [rewardAmount, setRewardAmount] = useState('');

  async function load() {
    try {
      const [u, c, t] = await Promise.all([api.get('/users'), api.get('/chores'), api.get('/templates')]);
      setUsers(u);
      setChores(c);
      setTemplates(t);
      if (assigneeIds.length === 0 && u.length > 0) {
        setAssigneeIds([u[0].id]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    }
  }

  useEffect(() => { load(); }, []);

  function buildSchedule() {
    if (scheduleType === 'one_time') {
      return { type: 'one_time', oneTimeDueAt: new Date(oneTimeDueAt).toISOString(), gracePeriodMinutes: grace };
    }
    if (scheduleType === 'repeating_calendar') {
      return { type: 'repeating_calendar', rrule, dueTime: dueTime || undefined, gracePeriodMinutes: grace };
    }
    return { type: 'repeating_after_completion', intervalDays, dueTime: dueTime || undefined, gracePeriodMinutes: grace };
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/chores', {
        title_en: titleEn,
        title_he: titleHe,
        hasReward,
        rewardAmount: hasReward ? rewardAmount : undefined,
        allowNotes: true,
        allowPhotoProof: false,
        schedule: buildSchedule(),
        assignment: { shared, mode, skipAwayUsers, assigneeIds },
      });
      setTitleEn('');
      setTitleHe('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create chore');
    }
  }

  async function onClone(templateId: string) {
    setError('');
    try {
      await api.post(`/templates/${templateId}/clone`);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to clone template');
    }
  }

  return (
    <div>
      <h2>Admin / Chores</h2>
      {error && <p className="error">{error}</p>}

      <form className="card form-grid" onSubmit={onCreate}>
        <input placeholder="Title EN" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} required />
        <input placeholder="Title HE" value={titleHe} onChange={(e) => setTitleHe(e.target.value)} required />

        <label>Schedule type
          <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as any)}>
            <option value="one_time">one_time</option>
            <option value="repeating_calendar">repeating_calendar</option>
            <option value="repeating_after_completion">repeating_after_completion</option>
          </select>
        </label>

        {scheduleType === 'one_time' && (
          <label>One-time due
            <input type="datetime-local" value={oneTimeDueAt} onChange={(e) => setOneTimeDueAt(e.target.value)} required />
          </label>
        )}
        {scheduleType === 'repeating_calendar' && (
          <input placeholder="RRULE" value={rrule} onChange={(e) => setRrule(e.target.value)} />
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

        <label>Grace minutes
          <input type="number" min={0} value={grace} onChange={(e) => setGrace(Number(e.target.value))} />
        </label>

        <label><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Shared chore</label>

        <label>Assignment mode
          <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="fixed">fixed</option>
            <option value="round_robin">round_robin</option>
          </select>
        </label>

        <label><input type="checkbox" checked={skipAwayUsers} onChange={(e) => setSkipAwayUsers(e.target.checked)} /> Skip away users</label>

        <label>Assignees
          <select
            multiple
            value={assigneeIds}
            onChange={(e) => setAssigneeIds([...e.currentTarget.selectedOptions].map((o) => o.value))}
          >
            {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
          </select>
        </label>

        <label><input type="checkbox" checked={hasReward} onChange={(e) => setHasReward(e.target.checked)} /> Has reward</label>
        {hasReward && <input placeholder="Reward amount" value={rewardAmount} onChange={(e) => setRewardAmount(e.target.value)} />}

        <button type="submit">Create chore</button>
      </form>

      <section className="card">
        <h3>Templates</h3>
        <ul>
          {templates.map((template) => (
            <li key={template.id}>
              {template.title_en} / {template.title_he}
              <button onClick={() => onClone(template.id)}>Clone</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3>Active chores</h3>
        <ul>
          {chores.map((chore) => (
            <li key={chore.id}>{chore.title_en} / {chore.title_he} {chore.hasReward ? `(reward ${chore.rewardAmount})` : ''}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
