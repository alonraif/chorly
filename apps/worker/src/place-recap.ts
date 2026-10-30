import { PrismaClient, type Locale } from '@prisma/client';
import { notificationText } from '@chorly/shared';
import { APP_BASE_URL, TENANT_ID_FILTER } from './lib/config';
import { notifyUser } from './lib/notify';

const prisma = new PrismaClient();

const WEEK_MS = 7 * 24 * 60 * 60_000;
const PLACES_PER_PERSON = 3;

function hours(ms: number, locale: Locale) {
  const h = Math.round(ms / 360_000) / 10;
  return locale === 'he' ? `${h} ש׳` : `${h}h`;
}

// Time spent at the family's places over the last week, for members who opted in, sent only to members who opted in.
async function runForTenant(tenantId: string) {
  const to = Date.now();
  const from = to - WEEK_MS;
  const members = await prisma.user.findMany({
    where: { tenantId, isActive: true, locationSettings: { recap: true } },
    select: { id: true, email: true, displayName: true, locale: true, notifyPrefs: true, location: { select: { updatedAt: true } } },
  });
  if (members.length === 0) return;

  const visits = await prisma.placeVisit.findMany({
    where: { userId: { in: members.map((m) => m.id) }, OR: [{ leftAt: null }, { leftAt: { gte: new Date(from) } }] },
    include: { place: { select: { name: true } } },
  });

  // Milliseconds per place, per member. A stay that began before the week only counts from its start.
  const totals = new Map<string, Map<string, number>>();
  for (const visit of visits) {
    const start = Math.max(visit.arrivedAt.getTime(), from);
    // A stay that never closed ends at the last report: a phone that died at school didn't stay there all week.
    const lastSeen = members.find((m) => m.id === visit.userId)?.location?.updatedAt.getTime() ?? to;
    const end = Math.min(visit.leftAt?.getTime() ?? lastSeen, to);
    if (end <= start) continue;
    const perPlace = totals.get(visit.userId) ?? new Map<string, number>();
    perPlace.set(visit.place.name, (perPlace.get(visit.place.name) ?? 0) + (end - start));
    totals.set(visit.userId, perPlace);
  }
  if (totals.size === 0) return;

  for (const recipient of members) {
    const lines = members.flatMap((member) => {
      const perPlace = totals.get(member.id);
      if (!perPlace) return [];
      const top = [...perPlace.entries()].sort((a, b) => b[1] - a[1]).slice(0, PLACES_PER_PERSON);
      return [`${member.displayName}: ${top.map(([name, ms]) => `${name} ${hours(ms, recipient.locale)}`).join(', ')}`];
    });
    if (lines.length === 0) continue;
    await notifyUser(prisma, recipient, 'placeRecap', { ...notificationText.placeRecap(recipient.locale, lines), url: `${APP_BASE_URL}/locator` });
  }
  console.log('[worker:place-recap] tenant done', { tenantId, members: members.length });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
