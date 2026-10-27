import { PrismaClient } from '@prisma/client';
import { TENANT_ID_FILTER, APP_BASE_URL } from './lib/config';
import { todayBounds } from './lib/time';
import { notifyUser } from './lib/notify';

const prisma = new PrismaClient();

async function runForTenant(tenantId: string) {
  const { from, to } = todayBounds();
  const instances = await prisma.choreInstance.findMany({
    where: { tenantId, dueAt: { gte: from, lte: to }, status: { in: ['assigned', 'done'] } },
    include: { chore: true, assignments: { include: { user: true } }, completions: true },
    orderBy: { dueAt: 'asc' },
  });

  const choresByUser = new Map<string, { id: string; email: string | null; displayName: string; lines: string[] }>();
  for (const instance of instances) {
    const activeDone = new Set(instance.completions.filter((c) => !c.undoneAt).map((c) => c.userId));
    for (const assignment of instance.assignments) {
      if (activeDone.has(assignment.userId)) continue;
      const entry = choresByUser.get(assignment.userId) || { id: assignment.userId, email: assignment.user.email, displayName: assignment.user.displayName, lines: [] };
      entry.lines.push(assignment.user.locale === 'he' ? instance.chore.title_he : instance.chore.title_en);
      choresByUser.set(assignment.userId, entry);
    }
  }

  for (const [, entry] of choresByUser) {
    await notifyUser(prisma, entry, {
      title: `☀️ ${entry.displayName}: ${entry.lines.length} chore(s) today`,
      body: entry.lines.join(' · '),
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
