import { PrismaClient, Prisma } from '@prisma/client';
import { TENANT_ID_FILTER, APP_BASE_URL } from './lib/config';
import { next7DaysRange, weekRangeLast7Days } from './lib/time';
import { sendEmail } from './lib/email';

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
    const preview = upcoming.filter((instance) => instance.assignments.some((a) => a.userId === user.id)).slice(0, 5).map((instance) => `- ${instance.chore.title_en} / ${instance.chore.title_he} (${instance.dueAt.toISOString()})`);

    await sendEmail(
      user.email,
      'Chorly weekly summary',
      `Hi ${user.displayName},\n\nLast week:\n- Approved chores: ${completed.length}\n- Money earned: ${earned.toString()}\n\nUpcoming:\n${preview.length ? preview.join('\n') : '- No upcoming chores in next 7 days'}\n\nOpen: ${APP_BASE_URL}/week`,
    );
  }

  console.log('[worker:weekly-summary] tenant done', { tenantId, users: users.length, from: lastWeek.from.toISOString(), to: lastWeek.to.toISOString() });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
