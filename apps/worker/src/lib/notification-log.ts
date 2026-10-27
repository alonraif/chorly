import type { NotificationKind, PrismaClient } from '@prisma/client';

type Sent = { userId: string; instanceId: string };

const key = (userId: string, instanceId: string) => `${userId}:${instanceId}`;

// Which (user, instance) pairs already got this kind of reminder for `day`.
export async function sentKeys(prisma: PrismaClient, kind: NotificationKind, day: string, instanceIds: string[]) {
  if (instanceIds.length === 0) return { has: () => false };
  const rows = await prisma.notificationLog.findMany({
    where: { kind, day, instanceId: { in: instanceIds } },
    select: { userId: true, instanceId: true },
  });
  const set = new Set(rows.map((r) => key(r.userId, r.instanceId)));
  return { has: (userId: string, instanceId: string) => set.has(key(userId, instanceId)) };
}

export async function markSent(prisma: PrismaClient, kind: NotificationKind, day: string, sent: Sent[]) {
  if (sent.length === 0) return;
  await prisma.notificationLog.createMany({
    data: sent.map((s) => ({ ...s, kind, day })),
    skipDuplicates: true,
  });
}
