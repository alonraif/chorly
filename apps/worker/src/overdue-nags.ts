import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { TENANT_ID_FILTER, APP_BASE_URL } from './lib/config';
import { gracePeriodMinutes } from './lib/schedule';
import { sendEmail } from './lib/email';

const prisma = new PrismaClient();

async function runForTenant(tenantId: string) {
  const now = DateTime.now().toJSDate();
  const instances = await prisma.choreInstance.findMany({
    where: { tenantId, status: { in: ['assigned', 'done'] }, dueAt: { lte: now } },
    include: { chore: true, assignments: { include: { user: true } }, completions: true },
    orderBy: { dueAt: 'asc' },
  });

  const nagsByUser = new Map<string, { email: string | null; displayName: string; lines: string[] }>();
  for (const instance of instances) {
    const graceMs = gracePeriodMinutes(instance.chore.scheduleJson) * 60 * 1000;
    const overdueAt = new Date(instance.dueAt.getTime() + graceMs);
    if (overdueAt > now) continue;

    const activeDone = new Set(instance.completions.filter((c) => !c.undoneAt).map((c) => c.userId));
    for (const assignment of instance.assignments) {
      if (activeDone.has(assignment.userId)) continue;
      const entry = nagsByUser.get(assignment.userId) || { email: assignment.user.email, displayName: assignment.user.displayName, lines: [] };
      entry.lines.push(`- ${instance.chore.title_en} / ${instance.chore.title_he} (due ${instance.dueAt.toISOString()})`);
      nagsByUser.set(assignment.userId, entry);
    }
  }

  for (const [, entry] of nagsByUser) {
    await sendEmail(entry.email, 'Chorly overdue chores', `Hi ${entry.displayName},\n\nThese chores are overdue:\n${entry.lines.join('\n')}\n\nOpen: ${APP_BASE_URL}/today`);
  }

  console.log('[worker:overdue-nags] tenant done', { tenantId, users: nagsByUser.size, instances: instances.length });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
