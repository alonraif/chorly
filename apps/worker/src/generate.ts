import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { TENANT_ID_FILTER, GENERATE_DAYS_AHEAD, APP_BASE_URL, TZ } from './lib/config';
import { eligibleUsers, selectAssigneeIds } from './lib/assignment';
import { dueDatesInRange, repeatingAfterCompletionConfig } from './lib/schedule';
import { rangeDaysAhead, parseDueTime } from './lib/time';
import { sendEmail } from './lib/email';

const prisma = new PrismaClient();

async function generateForChore(tenantId: string, chore: any, usersById: Map<string, any>, from: Date, to: Date) {
  const users = eligibleUsers(chore.assignmentJson, usersById);
  if (users.length === 0) return 0;

  const dueDates = new Set<number>();
  for (const due of dueDatesInRange(chore.scheduleJson, from, to)) dueDates.add(due.getTime());

  const afterCompletion = repeatingAfterCompletionConfig(chore.scheduleJson);
  if (afterCompletion) {
    const lastApproved = await prisma.choreInstance.findFirst({
      where: { tenantId, choreId: chore.id, approvedAt: { not: null } },
      orderBy: { approvedAt: 'desc' },
    });

    let cursor = lastApproved?.approvedAt ? DateTime.fromJSDate(lastApproved.approvedAt).setZone(TZ) : DateTime.now().setZone(TZ);
    const endsAtUtc = afterCompletion.endsAt ? DateTime.fromISO(afterCompletion.endsAt, { zone: 'utc' }).toJSDate() : null;
    while (true) {
      const candidate = parseDueTime(cursor.plus({ days: afterCompletion.intervalDays }), afterCompletion.dueTime);
      const candidateUtc = candidate.toUTC().toJSDate();
      if (endsAtUtc && candidateUtc > endsAtUtc) break;
      if (candidateUtc > to) break;
      if (candidateUtc >= from) dueDates.add(candidateUtc.getTime());
      cursor = candidate;
    }
  }

  let createdCount = 0;
  for (const dueAtMs of [...dueDates].sort((a, b) => a - b)) {
    const dueAt = new Date(dueAtMs);
    const existing = await prisma.choreInstance.findUnique({
      where: { tenantId_choreId_dueAt: { tenantId, choreId: chore.id, dueAt } },
    });
    if (existing) continue;

    const selection = selectAssigneeIds(chore.assignmentJson, users, chore.lastAssignedUserId);
    if (selection.assigneeIds.length === 0) continue;

    const created = await prisma.choreInstance.create({
      data: {
        tenantId,
        choreId: chore.id,
        dueAt,
        assignments: { create: selection.assigneeIds.map((userId) => ({ userId })) },
      },
    });

    if (selection.nextLastAssignedUserId !== chore.lastAssignedUserId) {
      await prisma.choreDefinition.update({ where: { id: chore.id }, data: { lastAssignedUserId: selection.nextLastAssignedUserId } });
      chore.lastAssignedUserId = selection.nextLastAssignedUserId;
    }

    createdCount += 1;
    const assignedUsers = users.filter((u) => selection.assigneeIds.includes(u.id));
    for (const user of assignedUsers) {
      await sendEmail(
        user.email,
        `Chorly assignment: ${chore.title_en}`,
        `Hi ${user.displayName},\n\nYou were assigned a chore.\n- ${chore.title_en} / ${chore.title_he}\n- Due: ${dueAt.toISOString()}\n\nOpen Chorly: ${APP_BASE_URL}/today`,
      );
    }

    console.log('[worker:generate] created', { tenantId, choreId: chore.id, instanceId: created.id, dueAt: dueAt.toISOString() });
  }

  return createdCount;
}

async function main() {
  const { from, to } = rangeDaysAhead(GENERATE_DAYS_AHEAD);
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });

  for (const tenant of tenants) {
    const [users, chores] = await Promise.all([
      prisma.user.findMany({ where: { tenantId: tenant.id } }),
      prisma.choreDefinition.findMany({ where: { tenantId: tenant.id, isTemplate: false, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));
    let totalCreated = 0;
    for (const chore of chores) {
      totalCreated += await generateForChore(tenant.id, chore, usersById, from, to);
    }

    console.log('[worker:generate] tenant done', {
      tenantId: tenant.id,
      window: { from: from.toISOString(), to: to.toISOString() },
      chores: chores.length,
      created: totalCreated,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
