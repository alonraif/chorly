import { PrismaClient, type Locale } from '@prisma/client';
import { choreName, notificationText } from '@chorly/shared';
import { DateTime } from 'luxon';
import { TENANT_ID_FILTER, APP_BASE_URL } from './lib/config';
import { gracePeriodMinutes } from './lib/schedule';
import { notifyUser } from './lib/notify';

const prisma = new PrismaClient();

async function runForTenant(tenantId: string) {
  const now = DateTime.now().toJSDate();
  const instances = await prisma.choreInstance.findMany({
    where: { tenantId, status: { in: ['assigned', 'done'] }, dueAt: { lte: now } },
    include: { chore: true, assignments: { include: { user: true } }, completions: true },
    orderBy: { dueAt: 'asc' },
  });

  const nagsByUser = new Map<string, { id: string; email: string | null; displayName: string; locale: Locale; lines: string[] }>();
  for (const instance of instances) {
    const graceMs = gracePeriodMinutes(instance.chore.scheduleJson) * 60 * 1000;
    const overdueAt = new Date(instance.dueAt.getTime() + graceMs);
    if (overdueAt > now) continue;

    const activeDone = new Set(instance.completions.filter((c) => !c.undoneAt).map((c) => c.userId));
    for (const assignment of instance.assignments) {
      if (activeDone.has(assignment.userId)) continue;
      const entry = nagsByUser.get(assignment.userId) || { id: assignment.userId, email: assignment.user.email, displayName: assignment.user.displayName, locale: assignment.user.locale, lines: [] };
      entry.lines.push(choreName(instance.chore, assignment.user.locale));
      nagsByUser.set(assignment.userId, entry);
    }
  }

  for (const [, entry] of nagsByUser) {
    await notifyUser(prisma, entry, {
      ...notificationText.overdue(entry.locale, entry.displayName, entry.lines),
      url: `${APP_BASE_URL}/child`,
    });
  }

  console.log('[worker:overdue-nags] tenant done', { tenantId, users: nagsByUser.size, instances: instances.length });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
