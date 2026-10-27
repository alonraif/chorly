import { PrismaClient, Prisma } from '@prisma/client';
import { notificationText } from '@chorly/shared';
import { TENANT_ID_FILTER, APP_BASE_URL } from './lib/config';
import { next7DaysRange, weekRangeLast7Days } from './lib/time';
import { notifyUser } from './lib/notify';

const prisma = new PrismaClient();

// Kids get their own week; parents get the family's.
async function runForTenant(tenantId: string) {
  const lastWeek = weekRangeLast7Days();
  const nextWeek = next7DaysRange();

  const [users, approvedInstances, earnings, missed, upcoming] = await Promise.all([
    prisma.user.findMany({ where: { tenantId, isActive: true }, orderBy: { createdAt: 'asc' } }),
    prisma.choreInstance.findMany({ where: { tenantId, status: 'approved', approvedAt: { gte: lastWeek.from, lte: lastWeek.to } }, include: { completions: true } }),
    prisma.moneyLedger.findMany({ where: { tenantId, type: 'earn', createdAt: { gte: lastWeek.from, lte: lastWeek.to } } }),
    prisma.choreInstance.count({ where: { tenantId, status: 'assigned', dueAt: { gte: lastWeek.from, lt: new Date() } } }),
    prisma.choreInstance.findMany({ where: { tenantId, dueAt: { gte: nextWeek.from, lte: nextWeek.to } }, include: { assignments: true } }),
  ]);

  const sum = (rows: typeof earnings) => rows.reduce((total, row) => total.plus(row.amount), new Prisma.Decimal(0));
  const approvedCount = (userId: string) =>
    approvedInstances.filter((instance) => instance.completions.some((c) => c.userId === userId && !c.undoneAt)).length;

  const kidLines = users.filter((u) => u.role === 'child').map((kid) => `${kid.displayName} ${approvedCount(kid.id)}`);
  const familyEarned = sum(earnings).toString();

  for (const user of users) {
    const msg = user.isAdmin
      ? notificationText.weeklyFamily(user.locale, approvedInstances.length, familyEarned, missed, kidLines)
      : notificationText.weekly(
          user.locale,
          user.displayName,
          approvedCount(user.id),
          sum(earnings.filter((row) => row.userId === user.id)).toString(),
          upcoming.filter((instance) => instance.assignments.some((a) => a.userId === user.id)).length,
        );
    await notifyUser(prisma, user, 'weekly', {
      ...msg,
      url: `${APP_BASE_URL}/${user.isAdmin ? 'parent' : 'child'}`,
    });
  }

  console.log('[worker:weekly-summary] tenant done', { tenantId, users: users.length, from: lastWeek.from.toISOString(), to: lastWeek.to.toISOString() });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
