import type { PrismaClient } from '@prisma/client';
import { FRESH_LOCATION_MS } from '@chorly/shared';

// Members who are, as far as the map knows, at school or at work right now. Nagging them about
// chores would only be noise; the reminder stays unsent, so a later run still reaches them.
export async function busyAway(prisma: PrismaClient, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Set<string>();
  const rows = await prisma.userLocation.findMany({
    where: {
      userId: { in: unique },
      updatedAt: { gte: new Date(Date.now() - FRESH_LOCATION_MS) },
      place: { kind: { in: ['school', 'work'] } },
    },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}
