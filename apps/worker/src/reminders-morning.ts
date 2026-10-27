import { PrismaClient, type Locale } from '@prisma/client';
import { choreName, notificationText } from '@chorly/shared';
import { TENANT_ID_FILTER, APP_BASE_URL } from './lib/config';
import { todayBounds } from './lib/time';
import { notifyUser } from './lib/notify';

const prisma = new PrismaClient();

async function runForTenant(tenantId: string) {
  const { from, to } = todayBounds();
  const instances = await prisma.choreInstance.findMany({
    where: { tenantId, dueAt: { gte: from, lte: to }, status: 'assigned' },
    include: { chore: true, assignments: { include: { user: true } }, completions: true },
    orderBy: { dueAt: 'asc' },
  });

  const choresByUser = new Map<string, { id: string; email: string | null; notifyPrefs: unknown; displayName: string; locale: Locale; lines: string[] }>();
  for (const instance of instances) {
    const activeDone = new Set(instance.completions.filter((c) => !c.undoneAt).map((c) => c.userId));
    for (const assignment of instance.assignments) {
      if (activeDone.has(assignment.userId)) continue;
      const entry = choresByUser.get(assignment.userId) || { id: assignment.userId, email: assignment.user.email, notifyPrefs: assignment.user.notifyPrefs, displayName: assignment.user.displayName, locale: assignment.user.locale, lines: [] };
      entry.lines.push(choreName(instance.chore, assignment.user.locale));
      choresByUser.set(assignment.userId, entry);
    }
  }

  for (const [, entry] of choresByUser) {
    await notifyUser(prisma, entry, 'morning', {
      ...notificationText.morning(entry.locale, entry.displayName, entry.lines.length, entry.lines),
      url: `${APP_BASE_URL}/child`,
    });
  }

  console.log('[worker:reminders-morning] tenant done', { tenantId, users: choresByUser.size, instances: instances.length });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
