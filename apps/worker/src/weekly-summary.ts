import { PrismaClient, Prisma } from '@prisma/client';
import { notificationText } from '@chorly/shared';
import { TENANT_ID_FILTER, APP_BASE_URL } from './lib/config';
import { next7DaysRange, weekRangeLast7Days } from './lib/time';
import { notifyUser } from './lib/notify';

const prisma = new PrismaClient();

async function runForTenant(tenantId: string) {
  const lastWeek = weekRangeLast7Days();
  const nextWeek = next7DaysRange();

  const [users, approvedInstances, ledger, upcoming] = await Promise.all([
    prisma.user.findMany({ where: { tenantId, isActive: true } }),
    prisma.choreInstance.findMany({ where: { tenantId, status: 'approved', approvedAt: { gte: lastWeek.from, lte: lastWeek.to } }, include: { chore: true, completions: true } }),
    prisma.moneyLedger.findMany({ where: { tenantId, createdAt: { gte: lastWeek.from, lte: lastWeek.to } } }),
    prisma.choreInstance.findMany({ where: { tenantId, dueAt: { gte: nextWeek.from, lte: nextWeek.to } }, include: { chore: true, assignments: true }, orderBy: { dueAt: 'asc' } }),
  ]);

  for (const user of users) {
    const completed = approvedInstances.filter((instance) => instance.completions.some((c) => c.userId === user.id && !c.undoneAt));
    const earned = ledger.filter((row) => row.userId === user.id).reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
    const upcomingCount = upcoming.filter((instance) => instance.assignments.some((a) => a.userId === user.id)).length;

    await notifyUser(prisma, user, {
      ...notificationText.weekly(user.locale, user.displayName, completed.length, earned.toString(), upcomingCount),
      url: `${APP_BASE_URL}/${user.role === 'child' ? 'child' : 'parent'}`,
    });
  }

  console.log('[worker:weekly-summary] tenant done', { tenantId, users: users.length, from: lastWeek.from.toISOString(), to: lastWeek.to.toISOString() });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
