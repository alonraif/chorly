'use client';

import { DateTime } from 'luxon';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  buildRrule,
  choreTitle,
  currencySymbol,
  firstName,
  now,
  parseRrule,
  scheduleSummary,
  TZ,
  WEEKDAYS,
  type ScheduleJson,
  type WeekdayCode,
} from '../lib/format';
import { useSession } from '../lib/session';
import type { Chore } from '../lib/types';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { errorMessage, Segmented, Sheet, Switch, useUi } from './ui';

type Freq = 'once' | 'daily' | 'weekly' | 'monthly' | 'interval';

type Draft = {
  title: string;
  assigneeIds: string[];
  freq: Freq;
  days: WeekdayCode[];
  monthlyPos: 1 | -1;
  monthlyDay: WeekdayCode;
  intervalDays: number;
  onceDate: string;
  onceTime: string;
  dueTime: string;
  hasReward: boolean;
  rewardAmount: string;
  endsMode: 'never' | 'on';
  endsDate: string;
  grace: number;
  skipAway: boolean;
  rawRrule: string | null;
};

function todayCode(): WeekdayCode {
  return WEEKDAYS[now().weekday % 7].code;
}

function emptyDraft(defaultAssignees: string[]): Draft {
  return {
    title: '',
    assigneeIds: defaultAssignees,
    freq: 'daily',
    days: [todayCode()],
    monthlyPos: 1,
    monthlyDay: 'SU',
    intervalDays: 2,
    onceDate: now().toISODate() || '',
    onceTime: '18:00',
    dueTime: '18:00',
    hasReward: false,
    rewardAmount: '',
    endsMode: 'never',
    endsDate: '',
    grace: 60,
    skipAway: true,
    rawRrule: null,
  };
}

function applySchedule(draft: Draft, schedule: ScheduleJson): Draft {
  const next: Draft = { ...draft, grace: schedule.gracePeriodMinutes ?? 60 };
  if (schedule.type === 'one_time') {
    const due = schedule.oneTimeDueAt ? DateTime.fromISO(schedule.oneTimeDueAt).setZone(TZ) : now();
    return { ...next, freq: 'once', onceDate: due.toISODate() || '', onceTime: due.toFormat('HH:mm') };
  }
  next.dueTime = schedule.dueTime || '18:00';
  if (schedule.endsAt) {
    next.endsMode = 'on';
    next.endsDate = DateTime.fromISO(schedule.endsAt).setZone(TZ).toISODate() || '';
  }
  if (schedule.type === 'repeating_after_completion') {
    return { ...next, freq: 'interval', intervalDays: schedule.intervalDays || 1 };
  }
  const parsed = schedule.rrule ? parseRrule(schedule.rrule) : null;
  if (!parsed) return { ...next, freq: 'weekly', rawRrule: schedule.rrule || null };
  if (parsed.freq === 'daily') return { ...next, freq: 'daily' };
  if (parsed.freq === 'weekly') {
    if (parsed.days.length === 7) return { ...next, freq: 'daily' };
    return { ...next, freq: 'weekly', days: parsed.days };
  }
  return { ...next, freq: 'monthly', monthlyPos: parsed.position, monthlyDay: parsed.day };
}

function buildSchedule(d: Draft): ScheduleJson {
  if (d.freq === 'once') {
    const due = DateTime.fromISO(`${d.onceDate}T${d.onceTime || '18:00'}`, { zone: TZ });
    return { type: 'one_time', oneTimeDueAt: due.toUTC().toISO() || '', gracePeriodMinutes: d.grace };
  }
  const endsAt =
    d.endsMode === 'on' && d.endsDate
      ? DateTime.fromISO(d.endsDate, { zone: TZ }).endOf('day').toUTC().toISO() || undefined
      : undefined;
  const common = { dueTime: d.dueTime || undefined, endsAt, gracePeriodMinutes: d.grace };
  if (d.freq === 'interval') return { type: 'repeating_after_completion', intervalDays: d.intervalDays, ...common };
  let rrule: string;
  if (d.freq === 'daily') rrule = buildRrule({ freq: 'daily' });
  else if (d.freq === 'weekly') rrule = d.rawRrule || buildRrule({ freq: 'weekly', days: d.days });
  else rrule = buildRrule({ freq: 'monthly', position: d.monthlyPos, day: d.monthlyDay });
  return { type: 'repeating_calendar', rrule, ...common };
}

export function ChoreEditor({
  open,
  onClose,
  choreId,
  template,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  choreId?: string | null;
  template?: Chore | null;
  onSaved: () => void;
}) {
  const { kids, currency } = useSession();
  const { toast, confirm } = useUi();
  const isEdit = !!choreId;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft([]));
  const [originalTitle, setOriginalTitle] = useState('');
  const [templates, setTemplates] = useState<Chore[]>([]);
  const [saveFavorite, setSaveFavorite] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  // Reset the form only when the editor opens or its target changes, never on unrelated re-renders.
  const kidsRef = useRef(kids);
  kidsRef.current = kids;

  useEffect(() => {
    if (!open) return;
    setError('');
    setShowMore(false);
    setSaveFavorite(false);
    const currentKids = kidsRef.current;
    const base = emptyDraft(currentKids.length === 1 ? [currentKids[0].id] : []);
    if (choreId) {
      setLoading(true);
      api
        .get(`/chores/${choreId}`)
        .then((chore: Chore) => {
          const withSchedule = applySchedule(base, chore.scheduleJson);
          setOriginalTitle(choreTitle(chore));
          setDraft({
            ...withSchedule,
            title: choreTitle(chore),
            assigneeIds: chore.assignmentJson?.assigneeIds || [],
            hasReward: chore.hasReward,
            rewardAmount: chore.rewardAmount ? String(Number(chore.rewardAmount)) : '',
            skipAway: chore.assignmentJson?.skipAwayUsers ?? true,
          });
        })
        .catch((err) => setError(errorMessage(err, 'Could not load this chore')))
        .finally(() => setLoading(false));
      return;
    }
    if (template) {
      setDraft({ ...applySchedule(base, template.scheduleJson), title: choreTitle(template) });
    } else {
      setDraft(base);
    }
    api.get('/templates').then(setTemplates).catch(() => setTemplates([]));
  }, [open, choreId, template]);

  const schedule = useMemo(() => buildSchedule(draft), [draft]);
  const chosenKids = kids.filter((k) => draft.assigneeIds.includes(k.id));
  const summary = [
    chosenKids.length ? chosenKids.map((k) => firstName(k.displayName)).join(chosenKids.length > 1 ? ' → ' : '') : 'Nobody yet',
    scheduleSummary(schedule),
    draft.hasReward && Number(draft.rewardAmount) > 0 ? `${currencySymbol(currency)}${draft.rewardAmount} reward` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  function toggleKid(id: string) {
    set('assigneeIds', draft.assigneeIds.includes(id) ? draft.assigneeIds.filter((x) => x !== id) : [...draft.assigneeIds, id]);
  }

  function toggleDay(code: WeekdayCode) {
    setDraft((prev) => ({
      ...prev,
      rawRrule: null,
      days: prev.days.includes(code) ? prev.days.filter((d) => d !== code) : [...prev.days, code],
    }));
  }

  function pickTemplate(t: Chore) {
    setDraft((prev) => ({ ...applySchedule(prev, t.scheduleJson), title: choreTitle(t), assigneeIds: prev.assigneeIds }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const title = draft.title.trim();
    if (!title) return setError('Give the chore a name.');
    if (draft.assigneeIds.length === 0) return setError('Choose who does this chore.');
    if (draft.freq === 'weekly' && draft.days.length === 0 && !draft.rawRrule) return setError('Pick at least one day.');
    if (draft.freq === 'once' && !draft.onceDate) return setError('Pick a date.');
    if (draft.hasReward && !(Number(draft.rewardAmount) > 0)) return setError('Enter a reward amount, or turn the reward off.');
    if (draft.freq !== 'once' && draft.endsMode === 'on' && !draft.endsDate) return setError('Pick an end date.');

    const shared = draft.assigneeIds.length > 1;
    // Keep separately-stored Hebrew/English names unless the parent actually renamed the chore.
    const titleChanged = !isEdit || title !== originalTitle;
    const payload = {
      ...(titleChanged ? { title_en: title, title_he: title } : {}),
      hasReward: draft.hasReward,
      rewardAmount: draft.hasReward ? String(Number(draft.rewardAmount)) : undefined,
      allowNotes: true,
      allowPhotoProof: false,
      schedule,
      assignment: {
        shared,
        mode: shared ? 'round_robin' : 'fixed',
        skipAwayUsers: draft.skipAway,
        assigneeIds: draft.assigneeIds,
      },
    };

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/chores/${choreId}`, payload);
        toast('Chore updated');
      } else {
        await api.post('/chores', payload);
        if (saveFavorite) await api.post('/templates', payload).catch(() => undefined);
        toast(`“${title}” added`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the chore'));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!choreId) return;
    const ok = await confirm({
      title: 'Delete this chore?',
      body: 'It stops repeating and upcoming unapproved occurrences are removed. Earnings already approved stay.',
      confirmLabel: 'Delete chore',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/chores/${choreId}`);
      toast('Chore deleted');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the chore'));
    }
  }

  const suggestions = templates.slice(0, 8);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit chore' : 'New chore'}
      subtitle={isEdit ? 'Changes apply to upcoming occurrences.' : undefined}
      size="lg"
      footer={
        <>
          {isEdit && (
            <button type="button" className="btn btn-ghost-danger" onClick={onDelete}>
              <Icon name="trash" size={18} /> Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="chore-editor" className="btn btn-primary" disabled={saving || loading}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add chore'}
          </button>
        </>
      }
    >
      <form id="chore-editor" className="stack-lg" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="chore-title">What needs doing?</label>
          <input
            id="chore-title"
            className="input input-lg"
            placeholder="e.g. Empty the dishwasher"
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            autoComplete="off"
            data-autofocus
          />
          {!isEdit && !draft.title && suggestions.length > 0 && (
            <div className="chip-row" aria-label="Suggestions">
              {suggestions.map((t) => (
                <button key={t.id} type="button" className="chip chip-suggest" onClick={() => pickTemplate(t)}>
                  {choreTitle(t)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-label">Who does it?</span>
          {kids.length === 0 ? (
            <p className="callout callout-warn">Add a kid on the Family page first.</p>
          ) : (
            <div className="chip-row">
              {kids.map((kid) => {
                const on = draft.assigneeIds.includes(kid.id);
                return (
                  <button
                    key={kid.id}
                    type="button"
                    className={`chip chip-person ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleKid(kid.id)}
                  >
                    <Avatar user={kid} size={26} />
                    {firstName(kid.displayName)}
                    {on && <Icon name="check" size={16} />}
                  </button>
                );
              })}
            </div>
          )}
          {draft.assigneeIds.length > 1 && (
            <p className="field-hint">
              <Icon name="repeat" size={14} /> They’ll take turns — each time goes to the next kid.
            </p>
          )}
        </div>

        <div className="field">
          <span className="field-label">How often?</span>
          <Segmented<Freq>
            label="How often"
            value={draft.freq}
            onChange={(v) => set('freq', v)}
            options={[
              { value: 'once', label: 'Once' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'interval', label: 'After done' },
            ]}
          />

          {draft.freq === 'weekly' && (
            <div className="day-picker" role="group" aria-label="Days">
              {WEEKDAYS.map((d) => {
                const on = draft.days.includes(d.code);
                return (
                  <button
                    key={d.code}
                    type="button"
                    className={`day-dot ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    aria-label={d.long}
                    onClick={() => toggleDay(d.code)}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          )}

          {draft.freq === 'monthly' && (
            <div className="row-2">
              <select className="input" value={draft.monthlyPos} onChange={(e) => set('monthlyPos', Number(e.target.value) as 1 | -1)} aria-label="Which week">
                <option value={1}>First</option>
                <option value={-1}>Last</option>
              </select>
              <select className="input" value={draft.monthlyDay} onChange={(e) => set('monthlyDay', e.target.value as WeekdayCode)} aria-label="Weekday">
                {WEEKDAYS.map((d) => (
                  <option key={d.code} value={d.code}>{d.long}</option>
                ))}
              </select>
            </div>
          )}

          {draft.freq === 'interval' && (
            <div className="inline-sentence">
              Next one is due
              <span className="stepper">
                <button type="button" className="icon-btn" aria-label="Fewer days" onClick={() => set('intervalDays', Math.max(1, draft.intervalDays - 1))}>
                  −
                </button>
                <span className="stepper-value">{draft.intervalDays}</span>
                <button type="button" className="icon-btn" aria-label="More days" onClick={() => set('intervalDays', draft.intervalDays + 1)}>
                  +
                </button>
              </span>
              {draft.intervalDays === 1 ? 'day' : 'days'} after it’s done
            </div>
          )}

          {draft.freq === 'once' ? (
            <div className="row-2">
              <label className="field">
                <span className="field-label-sm">Date</span>
                <input className="input" type="date" value={draft.onceDate} onChange={(e) => set('onceDate', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label-sm">Due by</span>
                <input className="input" type="time" value={draft.onceTime} onChange={(e) => set('onceTime', e.target.value)} />
              </label>
            </div>
          ) : (
            <label className="field">
              <span className="field-label-sm">Due by</span>
              <input className="input input-time" type="time" value={draft.dueTime} onChange={(e) => set('dueTime', e.target.value)} />
            </label>
          )}
        </div>

        <div className="field">
          <Switch
            checked={draft.hasReward}
            onChange={(v) => set('hasReward', v)}
            label="Pays a reward"
            hint="Added to the kid’s balance when you approve it."
          />
          {draft.hasReward && (
            <div className="money-input">
              <span>{currencySymbol(currency)}</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="5"
                value={draft.rewardAmount}
                onChange={(e) => set('rewardAmount', e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label="Reward amount"
              />
            </div>
          )}
        </div>

        <div className="disclosure">
          <button type="button" className="disclosure-toggle" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
            More options
            <Icon name="chevronDown" size={18} />
          </button>
          {showMore && (
            <div className="stack">
              {draft.freq !== 'once' && (
                <div className="field">
                  <span className="field-label-sm">Ends</span>
                  <Segmented
                    label="Ends"
                    value={draft.endsMode}
                    onChange={(v) => set('endsMode', v)}
                    options={[
                      { value: 'never', label: 'Never' },
                      { value: 'on', label: 'On a date' },
                    ]}
                  />
                  {draft.endsMode === 'on' && (
                    <input className="input" type="date" value={draft.endsDate} onChange={(e) => set('endsDate', e.target.value)} aria-label="End date" />
                  )}
                </div>
              )}
              <label className="field">
                <span className="field-label-sm">Counts as late after</span>
                <select className="input" value={draft.grace} onChange={(e) => set('grace', Number(e.target.value))}>
                  {[0, 15, 30, 60, 120, 240].map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? 'Right at the due time' : m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}
                    </option>
                  ))}
                  {![0, 15, 30, 60, 120, 240].includes(draft.grace) && <option value={draft.grace}>{draft.grace} minutes</option>}
                </select>
              </label>
              <Switch
                checked={draft.skipAway}
                onChange={(v) => set('skipAway', v)}
                label="Skip kids who are away"
                hint="Kids marked “Away” on the Family page won’t get this chore."
              />
              {!isEdit && (
                <Switch
                  checked={saveFavorite}
                  onChange={setSaveFavorite}
                  label="Save as a suggestion"
                  hint="Shows up as a one-tap suggestion next time."
                />
              )}
            </div>
          )}
        </div>

        <div className="summary-card">
          <Icon name="sparkle" size={18} />
          <span>{draft.title.trim() ? <strong>{draft.title.trim()}</strong> : 'New chore'} · {summary}</span>
        </div>

        {error && <p className="callout callout-error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
