import { DateTime } from 'luxon';
import { TZ } from './config';

export function nowTz() {
  return DateTime.now().setZone(TZ);
}

export function toUtcIso(date: DateTime): string {
  return date.toUTC().toISO() || '';
}

export function parseDueTime(base: DateTime, dueTime?: string | null) {
  if (!dueTime) return base;
  const [hourStr, minuteStr] = dueTime.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  return base.set({ hour, minute, second: 0, millisecond: 0 });
}

export function todayBounds() {
  const now = nowTz();
  return {
    from: now.startOf('day').toUTC().toJSDate(),
    to: now.endOf('day').toUTC().toJSDate(),
  };
}

export function rangeDaysAhead(days: number) {
  const now = nowTz();
  return {
    from: now.toUTC().toJSDate(),
    to: now.plus({ days }).endOf('day').toUTC().toJSDate(),
  };
}

export function weekRangeLast7Days() {
  const now = nowTz();
  const to = now.endOf('day');
  const from = to.minus({ days: 6 }).startOf('day');
  return { from: from.toUTC().toJSDate(), to: to.toUTC().toJSDate() };
}

export function next7DaysRange() {
  const now = nowTz();
  return {
    from: now.startOf('day').toUTC().toJSDate(),
    to: now.plus({ days: 7 }).endOf('day').toUTC().toJSDate(),
  };
}
