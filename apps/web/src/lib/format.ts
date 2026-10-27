import { DateTime } from 'luxon';
import { getCurrentLocale } from './user';

export const TZ = 'Asia/Jerusalem';

export type Locale = 'en' | 'he';
export type InstanceStatus = 'assigned' | 'done' | 'approved';

export type ChoreTitle = { title_en: string; title_he: string };

// Defaults to the signed-in member's language.
export function choreTitle(chore: ChoreTitle, locale: Locale = getCurrentLocale() || 'en') {
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
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return day.toFormat('EEEE');
  return day.toFormat('EEE, LLL d');
}

export function friendlyDue(iso: string) {
  const d = zoned(iso);
  return `${friendlyDay(d)} · ${d.toFormat('HH:mm')}`;
}

export function isOverdue(iso: string, status: InstanceStatus) {
  return status === 'assigned' && zoned(iso) < now();
}

export function relativeTime(iso: string) {
  return DateTime.fromISO(iso).toRelative({ style: 'short' }) || '';
}

export function money(amount: string | number | null | undefined, currencyCode = 'ILS') {
  const value = Number(amount || 0);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function currencySymbol(currencyCode = 'ILS') {
  const part = new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value || currencyCode;
}

export function greeting() {
  const hour = now().hour;
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function firstName(displayName: string) {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

// ---- Schedules ----

export const WEEKDAYS = [
  { code: 'SU', short: 'S', label: 'Sun', long: 'Sunday' },
  { code: 'MO', short: 'M', label: 'Mon', long: 'Monday' },
  { code: 'TU', short: 'T', label: 'Tue', long: 'Tuesday' },
  { code: 'WE', short: 'W', label: 'Wed', long: 'Wednesday' },
  { code: 'TH', short: 'T', label: 'Thu', long: 'Thursday' },
  { code: 'FR', short: 'F', label: 'Fri', long: 'Friday' },
  { code: 'SA', short: 'S', label: 'Sat', long: 'Saturday' },
] as const;

export type WeekdayCode = (typeof WEEKDAYS)[number]['code'];

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
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && ['SU', 'MO', 'TU', 'WE', 'TH'].every((d) => set.has(d as WeekdayCode))) return 'Sun–Thu';
  if (set.size === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => set.has(d as WeekdayCode))) return 'Weekdays';
  if (set.size === 2 && set.has('FR') && set.has('SA')) return 'Weekends';
  const labels = WEEKDAYS.filter((d) => set.has(d.code)).map((d) => (set.size === 1 ? d.long : d.label));
  if (labels.length === 1) return `Every ${labels[0]}`;
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
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
    return schedule.oneTimeDueAt ? `Once · ${friendlyDue(schedule.oneTimeDueAt)}` : 'Once';
  }
  const at = schedule.dueTime ? ` at ${schedule.dueTime}` : '';
  if (schedule.type === 'repeating_after_completion') {
    const n = schedule.intervalDays || 1;
    return `${n === 1 ? 'Every day' : `Every ${n} days`} after it’s done${at}`;
  }
  const parsed = schedule.rrule ? parseRrule(schedule.rrule) : null;
  let base = 'Repeating';
  if (parsed?.freq === 'daily') base = 'Every day';
  if (parsed?.freq === 'weekly') base = dayListLabel(parsed.days);
  if (parsed?.freq === 'monthly') {
    const day = WEEKDAYS.find((d) => d.code === parsed.day)?.long;
    base = `${parsed.position === 1 ? 'First' : 'Last'} ${day} of the month`;
  }
  return `${base}${at}`;
}
