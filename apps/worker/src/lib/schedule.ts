import { ChoreScheduleSchema } from '@chorly/shared';
import { RRule } from 'rrule';
import { DateTime } from 'luxon';
import { TZ } from './config';
import { parseDueTime } from './time';

export function dueDatesInRange(scheduleJson: unknown, from: Date, to: Date): Date[] {
  const schedule = ChoreScheduleSchema.parse(scheduleJson);
  const fromTz = DateTime.fromJSDate(from).setZone(TZ);
  const toTz = DateTime.fromJSDate(to).setZone(TZ);

  if (schedule.type === 'one_time') {
    const due = DateTime.fromISO(schedule.oneTimeDueAt, { zone: 'utc' });
    if (due >= fromTz.toUTC() && due <= toTz.toUTC()) {
      return [due.toJSDate()];
    }
    return [];
  }

  if (schedule.type === 'repeating_calendar') {
    const opts = RRule.parseString(schedule.rrule);
    opts.dtstart = fromTz.startOf('day').toUTC().toJSDate();
    const rule = new RRule(opts);
    const results = rule.between(from, to, true);
    return results.map((d) => {
      const withTime = parseDueTime(DateTime.fromJSDate(d).setZone(TZ), schedule.dueTime);
      return withTime.toUTC().toJSDate();
    });
  }

  return [];
}

export function gracePeriodMinutes(scheduleJson: unknown): number {
  const schedule = ChoreScheduleSchema.parse(scheduleJson);
  return schedule.gracePeriodMinutes ?? 60;
}

export function repeatingAfterCompletionConfig(scheduleJson: unknown): { intervalDays: number; dueTime?: string } | null {
  const schedule = ChoreScheduleSchema.parse(scheduleJson);
  if (schedule.type !== 'repeating_after_completion') return null;
  return { intervalDays: schedule.intervalDays, dueTime: schedule.dueTime };
}
