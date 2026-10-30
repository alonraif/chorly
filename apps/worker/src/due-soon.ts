import { PrismaClient, type Locale } from '@prisma/client';
import { choreName, notificationText } from '@chorly/shared';
import { TENANT_ID_FILTER, APP_BASE_URL, DUE_SOON_MINUTES, QUIET_HOURS } from './lib/config';
import { inQuietHours, localDay } from './lib/time';
import { notifyUser } from './lib/notify';
import { markSent, sentKeys } from './lib/notification-log';
import { busyAway } from './lib/presence';

const prisma = new PrismaClient();

// Runs every few minutes: reminds each assignee of open chores due within DUE_SOON_MINUTES, once per chore.
// Chores without a due time sit at midnight, so quiet hours keep them out.
async function runForTenant(tenantId: string) {
  const now = new Date();
  const until = new Date(now.getTime() + DUE_SOON_MINUTES * 60 * 1000);
  const instances = await prisma.choreInstance.findMany({
    where: { tenantId, status: 'assigned', dueAt: { gt: now, lte: until } },
    include: { chore: true, assignments: { include: { user: true } }, completions: true },
    orderBy: { dueAt: 'asc' },
  });
  if (instances.length === 0) return;

  const days = new Set(instances.map((i) => localDay(i.dueAt)));
  const sentByDay = new Map(await Promise.all([...days].map(async (d) => [d, await sentKeys(prisma, 'due_soon', d, instances.map((i) => i.id))] as const)));

  const busy = await busyAway(prisma, instances.flatMap((i) => i.assignments.map((a) => a.userId)));

  const byUser = new Map<string, { id: string; email: string | null; notifyPrefs: unknown; displayName: string; locale: Locale; firstDue: Date; lines: string[]; sent: Array<{ instanceId: string; day: string }> }>();
  for (const instance of instances) {
    const day = localDay(instance.dueAt);
    const activeDone = new Set(instance.completions.filter((c) => !c.undoneAt).map((c) => c.userId));
    for (const { user } of instance.assignments) {
      if (!user.isActive || busy.has(user.id) || activeDone.has(user.id) || sentByDay.get(day)!.has(user.id, instance.id)) continue;
      const entry = byUser.get(user.id) || { id: user.id, email: user.email, notifyPrefs: user.notifyPrefs, displayName: user.displayName, locale: user.locale, firstDue: instance.dueAt, lines: [], sent: [] };
      entry.lines.push(choreName(instance.chore, user.locale));
      entry.sent.push({ instanceId: instance.id, day });
      byUser.set(user.id, entry);
    }
  }

  for (const [, entry] of byUser) {
    const minutes = Math.max(1, Math.round((entry.firstDue.getTime() - now.getTime()) / 60000));
    await notifyUser(prisma, entry, 'dueSoon', {
      ...notificationText.dueSoon(entry.locale, entry.displayName, minutes, entry.lines),
      url: `${APP_BASE_URL}/child`,
    });
    for (const { instanceId, day } of entry.sent) await markSent(prisma, 'due_soon', day, [{ userId: entry.id, instanceId }]);
  }

  console.log('[worker:due-soon] tenant done', { tenantId, users: byUser.size, instances: instances.length });
}

async function main() {
  if (inQuietHours(QUIET_HOURS)) return;
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
