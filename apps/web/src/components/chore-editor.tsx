'use client';

import { DateTime } from 'luxon';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import {
  buildRrule,
  choreTitle,
  currencySymbol,
  firstName,
  money,
  now,
  parseRrule,
  scheduleSummary,
  TZ,
  weekdayCodeOf,
  weekdayName,
  WEEKDAYS,
  type ScheduleJson,
  type WeekdayCode,
} from '../lib/format';
import { joinNames, listJoin, t, tn } from '../lib/i18n';
import { useSession } from '../lib/session';
import type { Chore } from '../lib/types';
import { Avatar } from './avatar';
import { Icon } from './icon';
import { errorMessage, Segmented, Sheet, Switch, useUi } from './ui';

type Freq = 'once' | 'daily' | 'weekly' | 'monthly' | 'interval';

// With several kids: 'each' = everyone does their own (one chore per kid), 'turns' = rotate between them.
type Split = 'each' | 'turns';

type Draft = {
  title: string;
  assigneeIds: string[];
  split: Split;
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
  return weekdayCodeOf(now());
}

function emptyDraft(defaultAssignees: string[]): Draft {
  return {
    title: '',
    assigneeIds: defaultAssignees,
    split: 'each',
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
            split: (chore.assignmentJson?.assigneeIds?.length ?? 0) > 1 ? 'turns' : 'each',
            hasReward: chore.hasReward,
            rewardAmount: chore.rewardAmount ? String(Number(chore.rewardAmount)) : '',
            skipAway: chore.assignmentJson?.skipAwayUsers ?? true,
          });
        })
        .catch((err) => setError(errorMessage(err, t('editor.couldNotLoad'))))
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
    chosenKids.length
      ? draft.split === 'turns'
        ? joinNames(chosenKids.map((k) => firstName(k.displayName)), t('editor.turnsArrow'))
        : listJoin(chosenKids.map((k) => firstName(k.displayName)))
      : t('editor.nobody'),
    chosenKids.length > 1 ? (draft.split === 'turns' ? t('editor.takingTurns') : t('editor.eachOwn')) : null,
    scheduleSummary(schedule),
    draft.hasReward && Number(draft.rewardAmount) > 0 ? t('editor.reward', { amount: money(draft.rewardAmount, currency) }) : null,
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
    if (!title) return setError(t('editor.errName'));
    if (draft.assigneeIds.length === 0) return setError(t('editor.errWho'));
    if (draft.freq === 'weekly' && draft.days.length === 0 && !draft.rawRrule) return setError(t('editor.errDay'));
    if (draft.freq === 'once' && !draft.onceDate) return setError(t('editor.errDate'));
    if (draft.hasReward && !(Number(draft.rewardAmount) > 0)) return setError(t('editor.errReward'));
    if (draft.freq !== 'once' && draft.endsMode === 'on' && !draft.endsDate) return setError(t('editor.errEnd'));

    // Keep separately-stored Hebrew/English names unless the parent actually renamed the chore.
    const titleChanged = !isEdit || title !== originalTitle;
    const payloadFor = (assigneeIds: string[]) => {
      const shared = assigneeIds.length > 1;
      return {
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
          assigneeIds,
        },
      };
    };
    // Each occurrence has a single kid, so "each does it" becomes one chore per kid.
    const groups =
      draft.split === 'each' && draft.assigneeIds.length > 1 ? draft.assigneeIds.map((id) => [id]) : [draft.assigneeIds];
    const [first, ...rest] = groups;
    const withTitle = (assigneeIds: string[]) => ({ ...payloadFor(assigneeIds), title_en: title, title_he: title });

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/chores/${choreId}`, payloadFor(first));
        for (const ids of rest) await api.post('/chores', withTitle(ids));
        toast(rest.length ? tn('editor.updatedCopies', rest.length) : t('editor.updated'));
      } else {
        for (const ids of groups) await api.post('/chores', withTitle(ids));
        if (saveFavorite) await api.post('/templates', withTitle(first)).catch(() => undefined);
        toast(groups.length > 1 ? t('editor.addedFor', { title, count: groups.length }) : t('editor.added', { title }));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('editor.couldNotSave')));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!choreId) return;
    const ok = await confirm({
      title: t('editor.deleteTitle'),
      body: t('editor.deleteBody'),
      confirmLabel: t('editor.deleteConfirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/chores/${choreId}`);
      toast(t('editor.deleted'));
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('editor.couldNotDelete')));
    }
  }

  const suggestions = templates.slice(0, 8);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isEdit ? t('editor.editTitle') : t('common.newChore')}
      subtitle={isEdit ? t('editor.editSubtitle') : undefined}
      size="lg"
      footer={
        <>
          {isEdit && (
            <button type="button" className="btn btn-ghost-danger" onClick={onDelete}>
              <Icon name="trash" size={18} /> {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="chore-editor" className="btn btn-primary" disabled={saving || loading}>
            {saving ? t('common.saving') : isEdit ? t('editor.saveChanges') : t('editor.addChore')}
          </button>
        </>
      }
    >
      <form id="chore-editor" className="stack-lg" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="chore-title">{t('editor.what')}</label>
          <input
            id="chore-title"
            className="input input-lg"
            placeholder={t('editor.whatPlaceholder')}
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            autoComplete="off"
            data-autofocus
          />
          {!isEdit && !draft.title && suggestions.length > 0 && (
            <div className="chip-row" aria-label={t('editor.suggestions')}>
              {suggestions.map((t) => (
                <button key={t.id} type="button" className="chip chip-suggest" onClick={() => pickTemplate(t)}>
                  {choreTitle(t)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-label">{t('editor.who')}</span>
          {kids.length === 0 ? (
            <p className="callout callout-warn">{t('editor.addKidFirst')}</p>
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
            <>
              <Segmented<Split>
                label={t('editor.howShare')}
                value={draft.split}
                onChange={(v) => set('split', v)}
                options={[
                  { value: 'each', label: t('editor.each') },
                  { value: 'turns', label: t('editor.turns') },
                ]}
              />
              <p className="field-hint">
                {draft.split === 'each' ? (
                  <>
                    <Icon name="users" size={14} />
                    {isEdit ? t('editor.eachHintEdit') : t('editor.eachHintNew')}
                  </>
                ) : (
                  <>
                    <Icon name="repeat" size={14} /> {t('editor.turnsHint')}
                  </>
                )}
              </p>
            </>
          )}
        </div>

        <div className="field">
          <span className="field-label">{t('editor.howOften')}</span>
          <Segmented<Freq>
            label={t('editor.howOftenLabel')}
            value={draft.freq}
            onChange={(v) => set('freq', v)}
            options={[
              { value: 'once', label: t('editor.once') },
              { value: 'daily', label: t('editor.daily') },
              { value: 'weekly', label: t('editor.weekly') },
              { value: 'monthly', label: t('editor.monthly') },
              { value: 'interval', label: t('editor.afterDone') },
            ]}
          />

          {draft.freq === 'weekly' && (
            <div className="day-picker" role="group" aria-label={t('editor.days')}>
              {WEEKDAYS.map((d) => {
                const on = draft.days.includes(d.code);
                return (
                  <button
                    key={d.code}
                    type="button"
                    className={`day-dot ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    aria-label={weekdayName(d.code, 'long')}
                    onClick={() => toggleDay(d.code)}
                  >
                    {weekdayName(d.code, 'short')}
                  </button>
                );
              })}
            </div>
          )}

          {draft.freq === 'monthly' && (
            <div className="row-2">
              <select className="input" value={draft.monthlyPos} onChange={(e) => set('monthlyPos', Number(e.target.value) as 1 | -1)} aria-label={t('editor.whichWeek')}>
                <option value={1}>{t('editor.first')}</option>
                <option value={-1}>{t('editor.last')}</option>
              </select>
              <select className="input" value={draft.monthlyDay} onChange={(e) => set('monthlyDay', e.target.value as WeekdayCode)} aria-label={t('editor.weekday')}>
                {WEEKDAYS.map((d) => (
                  <option key={d.code} value={d.code}>{weekdayName(d.code, 'long')}</option>
                ))}
              </select>
            </div>
          )}

          {draft.freq === 'interval' && (
            <div className="inline-sentence">
              {t('editor.intervalBefore')}
              <span className="stepper">
                <button type="button" className="icon-btn" aria-label={t('editor.fewerDays')} onClick={() => set('intervalDays', Math.max(1, draft.intervalDays - 1))}>
                  −
                </button>
                <span className="stepper-value">{draft.intervalDays}</span>
                <button type="button" className="icon-btn" aria-label={t('editor.moreDays')} onClick={() => set('intervalDays', draft.intervalDays + 1)}>
                  +
                </button>
              </span>
              {tn('editor.intervalAfter', draft.intervalDays)}
            </div>
          )}

          {draft.freq === 'once' ? (
            <div className="row-2">
              <label className="field">
                <span className="field-label-sm">{t('editor.date')}</span>
                <input className="input" type="date" value={draft.onceDate} onChange={(e) => set('onceDate', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label-sm">{t('editor.dueBy')}</span>
                <input className="input" type="time" value={draft.onceTime} onChange={(e) => set('onceTime', e.target.value)} />
              </label>
            </div>
          ) : (
            <label className="field">
              <span className="field-label-sm">{t('editor.dueBy')}</span>
              <input className="input input-time" type="time" value={draft.dueTime} onChange={(e) => set('dueTime', e.target.value)} />
            </label>
          )}
        </div>

        <div className="field">
          <Switch
            checked={draft.hasReward}
            onChange={(v) => set('hasReward', v)}
            label={t('editor.paysReward')}
            hint={t('editor.paysRewardHint')}
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
                aria-label={t('approvals.rewardAmount')}
              />
            </div>
          )}
        </div>

        <div className="disclosure">
          <button type="button" className="disclosure-toggle" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
            {t('common.moreOptions')}
            <Icon name="chevronDown" size={18} />
          </button>
          {showMore && (
            <div className="stack">
              {draft.freq !== 'once' && (
                <div className="field">
                  <span className="field-label-sm">{t('editor.ends')}</span>
                  <Segmented
                    label={t('editor.ends')}
                    value={draft.endsMode}
                    onChange={(v) => set('endsMode', v)}
                    options={[
                      { value: 'never', label: t('editor.never') },
                      { value: 'on', label: t('editor.onDate') },
                    ]}
                  />
                  {draft.endsMode === 'on' && (
                    <input className="input" type="date" value={draft.endsDate} onChange={(e) => set('endsDate', e.target.value)} aria-label={t('editor.endDate')} />
                  )}
                </div>
              )}
              <label className="field">
                <span className="field-label-sm">{t('editor.lateAfter')}</span>
                <select className="input" value={draft.grace} onChange={(e) => set('grace', Number(e.target.value))}>
                  {[0, 15, 30, 60, 120, 240].map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? t('editor.rightAtDue') : m < 60 ? tn('editor.minutes', m) : tn('editor.hours', m / 60)}
                    </option>
                  ))}
                  {![0, 15, 30, 60, 120, 240].includes(draft.grace) && <option value={draft.grace}>{tn('editor.minutes', draft.grace)}</option>}
                </select>
              </label>
              <Switch
                checked={draft.skipAway}
                onChange={(v) => set('skipAway', v)}
                label={t('editor.skipAway')}
                hint={t('editor.skipAwayHint')}
              />
              {!isEdit && (
                <Switch
                  checked={saveFavorite}
                  onChange={setSaveFavorite}
                  label={t('editor.saveSuggestion')}
                  hint={t('editor.saveSuggestionHint')}
                />
              )}
            </div>
          )}
        </div>

        <div className="summary-card">
          <Icon name="sparkle" size={18} />
          <span>
            {draft.title.trim() ? <bdi><strong>{draft.title.trim()}</strong></bdi> : t('common.newChore')} · {summary}
          </span>
        </div>

        {error && <p className="callout callout-error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
