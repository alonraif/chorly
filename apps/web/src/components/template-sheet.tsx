'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  WEEKDAYS,
  buildRrule,
  choreTitle,
  currencySymbol,
  parseRrule,
  scheduleSummary,
  weekdayName,
  type WeekdayCode,
} from '../lib/format';
import { t } from '../lib/i18n';
import { useSession } from '../lib/session';
import type { Chore } from '../lib/types';
import { Segmented, Sheet, Switch, errorMessage, useUi } from './ui';

type Freq = 'daily' | 'weekly' | 'monthly';

type Draft = {
  title: string;
  freq: Freq;
  days: WeekdayCode[];
  monthlyPos: 1 | -1;
  monthlyDay: WeekdayCode;
  dueTime: string;
  hasReward: boolean;
  rewardAmount: string;
};

const EMPTY: Draft = {
  title: '',
  freq: 'daily',
  days: ['SU'],
  monthlyPos: 1,
  monthlyDay: 'SU',
  dueTime: '18:00',
  hasReward: false,
  rewardAmount: '',
};

function draftFrom(template: Chore | null | undefined): { draft: Draft; parsed: boolean } {
  if (!template) return { draft: EMPTY, parsed: true };
  const schedule = template.scheduleJson;
  const rule = schedule?.type === 'repeating_calendar' && schedule.rrule ? parseRrule(schedule.rrule) : null;
  const draft: Draft = {
    ...EMPTY,
    title: choreTitle(template),
    dueTime: schedule?.dueTime || EMPTY.dueTime,
    hasReward: !!template.hasReward,
    rewardAmount: template.rewardAmount ? String(Number(template.rewardAmount)) : '',
  };
  if (rule?.freq === 'daily') draft.freq = 'daily';
  if (rule?.freq === 'weekly') Object.assign(draft, { freq: 'weekly', days: rule.days });
  if (rule?.freq === 'monthly') Object.assign(draft, { freq: 'monthly', monthlyPos: rule.position, monthlyDay: rule.day });
  return { draft, parsed: !!rule };
}

// Add or edit a Quick add suggestion (a chore template): name, repeat schedule, optional reward.
export function TemplateSheet({
  open,
  template,
  onClose,
  onSaved,
}: {
  open: boolean;
  template?: Chore | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { kids, currency } = useSession();
  const { toast } = useUi();
  const isEdit = !!template;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [knownSchedule, setKnownSchedule] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const { draft: next, parsed } = draftFrom(template);
    setDraft(next);
    setKnownSchedule(parsed);
    setScheduleTouched(false);
    setError('');
    setSaving(false);
  }, [open, template]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setSchedule = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setScheduleTouched(true);
    set(key, value);
  };
  const toggleDay = (code: WeekdayCode) => {
    setScheduleTouched(true);
    setDraft((d) => ({ ...d, days: d.days.includes(code) ? d.days.filter((c) => c !== code) : [...d.days, code] }));
  };

  const needsKid = !isEdit && kids.length === 0;
  // An unrecognised schedule (e.g. saved from the full editor) is kept unless the parent picks a new one.
  const keepSchedule = isEdit && !knownSchedule && !scheduleTouched;

  const save = async () => {
    const title = draft.title.trim();
    if (!title) return setError(t('editor.errName'));
    if (!keepSchedule && draft.freq === 'weekly' && draft.days.length === 0) return setError(t('editor.errDay'));
    const amount = Number(draft.rewardAmount);
    if (draft.hasReward && !(amount > 0)) return setError(t('editor.errReward'));
    if (needsKid) return setError(t('quickAdd.needKid'));

    const rrule =
      draft.freq === 'daily'
        ? buildRrule({ freq: 'daily' })
        : draft.freq === 'weekly'
          ? buildRrule({ freq: 'weekly', days: draft.days })
          : buildRrule({ freq: 'monthly', position: draft.monthlyPos, day: draft.monthlyDay });
    const schedule = {
      type: 'repeating_calendar' as const,
      rrule,
      dueTime: draft.dueTime || undefined,
      gracePeriodMinutes: template?.scheduleJson?.gracePeriodMinutes ?? 60,
    };
    const reward = {
      hasReward: draft.hasReward,
      rewardAmount: draft.hasReward ? String(Math.round(amount * 100) / 100) : undefined,
    };

    setSaving(true);
    setError('');
    try {
      if (template) {
        const titleChanged = title !== choreTitle(template);
                await api.patch(`/templates/${template.id}`, {
          ...(titleChanged ? { title_en: title, title_he: title } : {}),
          ...(keepSchedule ? {} : { schedule }),
          ...reward,
        });
        toast(t('quickAdd.saved'));
      } else {
        await api.post('/templates', {
          title_en: title,
          title_he: title,
          ...reward,
          schedule,
          assignment: { mode: 'fixed', shared: false, skipAwayUsers: true, assigneeIds: [kids[0].id] },
        });
        toast(t('quickAdd.added'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('quickAdd.couldNotSave')));
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title={isEdit ? t('quickAdd.editTitle') : t('quickAdd.newTitle')}
      subtitle={t('quickAdd.sheetSubtitle')}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || needsKid}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        className="qa-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {needsKid && <p className="callout callout-warn">{t('quickAdd.needKid')}</p>}
        {error && <p className="callout callout-error" role="alert">{error}</p>}

        <div className="field">
          <label className="field-label" htmlFor="qa-title">{t('quickAdd.name')}</label>
          <input
            id="qa-title"
            className="input"
            value={draft.title}
            placeholder={t('editor.whatPlaceholder')}
            onChange={(e) => set('title', e.target.value)}
            maxLength={80}
            data-autofocus
          />
        </div>

        <div className="field">
          <span className="field-label">{t('editor.howOften')}</span>
          <Segmented<Freq>
            label={t('editor.howOftenLabel')}
            value={keepSchedule ? ('' as Freq) : draft.freq}
            onChange={(v) => setSchedule('freq', v)}
            options={[
              { value: 'daily', label: t('editor.daily') },
              { value: 'weekly', label: t('editor.weekly') },
              { value: 'monthly', label: t('editor.monthly') },
            ]}
          />
          {keepSchedule && template && (
            <p className="field-hint">{t('quickAdd.currentSchedule', { schedule: scheduleSummary(template.scheduleJson) })}</p>
          )}

          {!keepSchedule && draft.freq === 'weekly' && (
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

          {!keepSchedule && draft.freq === 'monthly' && (
            <div className="row-2">
              <select
                className="input"
                value={draft.monthlyPos}
                onChange={(e) => setSchedule('monthlyPos', Number(e.target.value) as 1 | -1)}
                aria-label={t('editor.whichWeek')}
              >
                <option value={1}>{t('editor.first')}</option>
                <option value={-1}>{t('editor.last')}</option>
              </select>
              <select
                className="input"
                value={draft.monthlyDay}
                onChange={(e) => setSchedule('monthlyDay', e.target.value as WeekdayCode)}
                aria-label={t('editor.weekday')}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.code} value={d.code}>{weekdayName(d.code, 'long')}</option>
                ))}
              </select>
            </div>
          )}

          {!keepSchedule && (
            <label className="field">
              <span className="field-label-sm">{t('editor.dueBy')}</span>
              <input className="input input-time" type="time" value={draft.dueTime} onChange={(e) => setSchedule('dueTime', e.target.value)} />
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
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}
