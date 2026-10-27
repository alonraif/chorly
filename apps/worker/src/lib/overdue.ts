import type { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { OVERDUE_MAX_DAYS } from './config';
import { gracePeriodMinutes } from './schedule';

// Open chores past due + grace, from the last OVERDUE_MAX_DAYS days, with the assignees who haven't done them.
// Only `assigned` counts: a `done` instance is complete (e.g. a shared chore one kid already did).
export async function findOverdue(prisma: PrismaClient, tenantId: string) {
  const now = new Date();
  const oldest = DateTime.now().minus({ days: OVERDUE_MAX_DAYS }).toJSDate();
  const instances = await prisma.choreInstance.findMany({
    where: { tenantId, status: 'assigned', dueAt: { gte: oldest, lte: now } },
    include: { chore: true, assignments: { include: { user: true } }, completions: true },
    orderBy: { dueAt: 'asc' },
  });

  return instances
    .filter((instance) => instance.dueAt.getTime() + gracePeriodMinutes(instance.chore.scheduleJson) * 60 * 1000 <= now.getTime())
    .map((instance) => {
      const activeDone = new Set(instance.completions.filter((c) => !c.undoneAt).map((c) => c.userId));
      const pending = instance.assignments.map((a) => a.user).filter((u) => u.isActive && !activeDone.has(u.id));
      return { instance, pending };
    })
    .filter((row) => row.pending.length > 0);
}
