import { PrismaClient } from '@prisma/client';
import { choreName, notificationText } from '@chorly/shared';
import { TENANT_ID_FILTER, APP_BASE_URL } from './lib/config';
import { localDay } from './lib/time';
import { notifyUser } from './lib/notify';
import { findOverdue } from './lib/overdue';
import { markSent, sentKeys } from './lib/notification-log';

const prisma = new PrismaClient();

// Evening digest to each parent of overdue chores in the family, leaving out the parent's own.
async function runForTenant(tenantId: string) {
  const day = localDay();
  const [overdue, parents] = await Promise.all([
    findOverdue(prisma, tenantId),
    prisma.user.findMany({ where: { tenantId, isActive: true, isAdmin: true } }),
  ]);
  const sent = await sentKeys(prisma, 'parent_overdue', day, overdue.map((o) => o.instance.id));

  let notified = 0;
  for (const parent of parents) {
    const lines: string[] = [];
    const instanceIds: string[] = [];
    for (const { instance, pending } of overdue) {
      if (sent.has(parent.id, instance.id)) continue;
      const others = pending.filter((u) => u.id !== parent.id);
      if (others.length === 0) continue;
      const chore = choreName(instance.chore, parent.locale);
      for (const kid of others) lines.push(`${kid.displayName} – ${chore}`);
      instanceIds.push(instance.id);
    }
    if (lines.length === 0) continue;

    await notifyUser(prisma, parent, 'parentDigest', {
      ...notificationText.parentOverdue(parent.locale, lines),
      url: `${APP_BASE_URL}/parent`,
    });
    await markSent(prisma, 'parent_overdue', day, instanceIds.map((instanceId) => ({ userId: parent.id, instanceId })));
    notified++;
  }

  console.log('[worker:parent-nag] tenant done', { tenantId, parents: notified, instances: overdue.length });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
