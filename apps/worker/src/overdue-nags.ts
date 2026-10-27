import { PrismaClient, type Locale } from '@prisma/client';
import { choreName, notificationText } from '@chorly/shared';
import { TENANT_ID_FILTER, APP_BASE_URL } from './lib/config';
import { localDay } from './lib/time';
import { notifyUser } from './lib/notify';
import { findOverdue } from './lib/overdue';
import { markSent, sentKeys } from './lib/notification-log';

const prisma = new PrismaClient();

// Each overdue chore is nagged about at most once a day, so a later run only lists what became overdue since.
async function runForTenant(tenantId: string) {
  const day = localDay();
  const overdue = await findOverdue(prisma, tenantId);
  const sent = await sentKeys(prisma, 'overdue', day, overdue.map((o) => o.instance.id));

  const nagsByUser = new Map<string, { id: string; email: string | null; displayName: string; locale: Locale; lines: string[]; instanceIds: string[] }>();
  for (const { instance, pending } of overdue) {
    for (const user of pending) {
      if (sent.has(user.id, instance.id)) continue;
      const entry = nagsByUser.get(user.id) || { id: user.id, email: user.email, displayName: user.displayName, locale: user.locale, lines: [], instanceIds: [] };
      entry.lines.push(choreName(instance.chore, user.locale));
      entry.instanceIds.push(instance.id);
      nagsByUser.set(user.id, entry);
    }
  }

  for (const [, entry] of nagsByUser) {
    await notifyUser(prisma, entry, {
      ...notificationText.overdue(entry.locale, entry.displayName, entry.lines),
      url: `${APP_BASE_URL}/child`,
    });
    await markSent(prisma, 'overdue', day, entry.instanceIds.map((instanceId) => ({ userId: entry.id, instanceId })));
  }

  console.log('[worker:overdue-nags] tenant done', { tenantId, users: nagsByUser.size, instances: overdue.length });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
