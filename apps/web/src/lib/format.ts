import { DateTime } from 'luxon';
import { getLocale, intlLocale, listJoin, t, tn, type Locale } from './i18n';

export const TZ = 'Asia/Jerusalem';

export type { Locale };
export type InstanceStatus = 'assigned' | 'done' | 'approved';

export type ChoreTitle = { title_en: string; title_he: string };

// Defaults to the signed-in member's language.
export function choreTitle(chore: ChoreTitle, locale: Locale = getLocale()) {
  if (locale === 'he') return chore.title_he || chore.title_en;
  return chore.title_en || chore.title_he;
}

export function zoned(iso: string) {
  return DateTime.fromISO(iso).setZone(TZ);
}

export function now() {
  return DateTime.now().setZone(TZ);
}

export function timeOf(iso: string) {
  return zoned(iso).toFormat('HH:mm');
}

export function dayKey(iso: string) {
  return zoned(iso).toISODate() || '';
}

export function friendlyDay(day: DateTime) {
  const today = now().startOf('day');
  const diff = Math.round(day.startOf('day').diff(today, 'days').days);
  if (diff === 0) return t('common.today');
  if (diff === 1) return t('common.tomorrow');
  if (diff === -1) return t('common.yesterday');
  if (diff > 1 && diff < 7) return day.toLocaleString({ weekday: 'long' });
  return shortDate(day);
}

// "Tue, Oct 27" / "יום ג׳, 27 באוק׳"
export function shortDate(day: DateTime) {
  return day.toLocaleString({ weekday: 'short', month: 'short', day: 'numeric' });
}

// "Tuesday, October 27" / "יום שלישי, 27 באוקטובר"
export function longDate(day: DateTime) {
  return day.toLocaleString({ weekday: 'long', month: 'long', day: 'numeric' });
}

export function friendlyDue(iso: string) {
  const d = zoned(iso);
  return `${friendlyDay(d)} · ${d.toFormat('HH:mm')}`;
}

export function isOverdue(iso: string, status: InstanceStatus) {
  return status === 'assigned' && zoned(iso) < now();
}

export function relativeTime(iso: string) {
  const dt = DateTime.fromISO(iso);
  if (getLocale() === 'he') {
    // Hebrew CLDR appends the count to singular/dual forms ("לפני שעה (1)"); drop it.
    return (dt.toRelative({ style: 'long' }) || '').replace(/\s*\(\d+\)/, '');
  }
  return dt.toRelative({ style: 'short' }) || '';
}

export function money(amount: string | number | null | undefined, currencyCode = 'ILS') {
  const value = Number(amount || 0);
  return new Intl.NumberFormat(intlLocale(), {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function currencySymbol(currencyCode = 'ILS') {
  const part = new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: currencyCode })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value || currencyCode;
}

export function greeting() {
  const hour = now().hour;
  if (hour < 5) return t('greeting.night');
  if (hour < 12) return t('greeting.morning');
  if (hour < 18) return t('greeting.afternoon');
  return t('greeting.evening');
}

export function firstName(displayName: string) {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

// ---- Schedules ----

export const WEEKDAYS = [{ code: 'SU' }, { code: 'MO' }, { code: 'TU' }, { code: 'WE' }, { code: 'TH' }, { code: 'FR' }, { code: 'SA' }] as const;

export type WeekdayCode = (typeof WEEKDAYS)[number]['code'];

// short: one-letter day picker dot · label: list/strip label · long: full name
const WEEKDAY_NAMES: Record<Locale, Record<'short' | 'label' | 'long', string[]>> = {
  en: {
    short: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    long: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  },
  he: {
    short: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'],
    label: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
    long: ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'],
  },
};

export function weekdayName(code: WeekdayCode, form: 'short' | 'label' | 'long' = 'long') {
  return WEEKDAY_NAMES[getLocale()][form][WEEKDAYS.findIndex((d) => d.code === code)];
}

// Luxon weekday is 1 (Mon) … 7 (Sun).
export function weekdayCodeOf(day: DateTime): WeekdayCode {
  return WEEKDAYS[day.weekday % 7].code;
}

export type ParsedRrule =
  | { freq: 'daily' }
  | { freq: 'weekly'; days: WeekdayCode[] }
  | { freq: 'monthly'; position: 1 | -1; day: WeekdayCode };

export function parseRrule(rrule: string): ParsedRrule | null {
  const parts = Object.fromEntries(
    rrule.split(';').map((p) => {
      const [k, v] = p.split('=');
      return [k?.toUpperCase(), v?.toUpperCase()];
    }),
  ) as Record<string, string | undefined>;
  if (parts.FREQ === 'DAILY' && !parts.BYDAY) return { freq: 'daily' };
  if (parts.FREQ === 'WEEKLY' && parts.BYDAY) {
    const codes = WEEKDAYS.map((d) => d.code as string);
    const days = parts.BYDAY.split(',').filter((d) => codes.includes(d)) as WeekdayCode[];
    if (days.length) return { freq: 'weekly', days };
  }
  if (parts.FREQ === 'MONTHLY' && parts.BYDAY) {
    const m = parts.BYDAY.match(/^(-?1)(SU|MO|TU|WE|TH|FR|SA)$/);
    if (m) return { freq: 'monthly', position: Number(m[1]) as 1 | -1, day: m[2] as WeekdayCode };
  }
  return null;
}

export function buildRrule(parsed: ParsedRrule) {
  if (parsed.freq === 'daily') return 'FREQ=DAILY';
  if (parsed.freq === 'weekly') {
    const ordered = WEEKDAYS.map((d) => d.code).filter((c) => parsed.days.includes(c));
    return `FREQ=WEEKLY;BYDAY=${ordered.join(',')}`;
  }
  return `FREQ=MONTHLY;BYDAY=${parsed.position}${parsed.day}`;
}

function dayListLabel(days: WeekdayCode[]) {
  const set = new Set(days);
  if (set.size === 7) return t('sched.everyDay');
  if (set.size === 5 && ['SU', 'MO', 'TU', 'WE', 'TH'].every((d) => set.has(d as WeekdayCode))) return t('sched.sunThu');
  if (set.size === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => set.has(d as WeekdayCode))) return t('sched.weekdays');
  if (set.size === 2 && set.has('FR') && set.has('SA')) return t('sched.weekends');
  const picked = WEEKDAYS.filter((d) => set.has(d.code));
  if (picked.length === 1) return t('sched.everyWeekday', { day: weekdayName(picked[0].code, 'long') });
  return listJoin(picked.map((d) => weekdayName(d.code, 'label')));
}

export type ScheduleJson = {
  type: 'one_time' | 'repeating_calendar' | 'repeating_after_completion';
  oneTimeDueAt?: string;
  rrule?: string;
  intervalDays?: number;
  dueTime?: string;
  endsAt?: string;
  gracePeriodMinutes?: number;
};

export function scheduleSummary(schedule: ScheduleJson | null | undefined) {
  if (!schedule) return '';
  if (schedule.type === 'one_time') {
    return schedule.oneTimeDueAt ? t('sched.onceAt', { when: friendlyDue(schedule.oneTimeDueAt) }) : t('sched.once');
  }
  const withTime = (base: string) => (schedule.dueTime ? t('sched.at', { base, time: schedule.dueTime }) : base);
  if (schedule.type === 'repeating_after_completion') {
    return withTime(t('sched.afterDone', { every: tn('sched.everyNDays', schedule.intervalDays || 1) }));
  }
  const parsed = schedule.rrule ? parseRrule(schedule.rrule) : null;
  let base = t('sched.repeating');
  if (parsed?.freq === 'daily') base = t('sched.everyDay');
  if (parsed?.freq === 'weekly') base = dayListLabel(parsed.days);
  if (parsed?.freq === 'monthly') {
    const day = weekdayName(parsed.day, 'long');
    base = t(parsed.position === 1 ? 'sched.firstOfMonth' : 'sched.lastOfMonth', { day });
  }
  return withTime(base);
}
