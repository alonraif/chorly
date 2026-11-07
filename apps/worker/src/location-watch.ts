import { PrismaClient } from '@prisma/client';
import { FRESH_LOCATION_MS, notificationText } from '@chorly/shared';
import { APP_BASE_URL, TENANT_ID_FILTER } from './lib/config';
import { notifyUser } from './lib/notify';

const prisma = new PrismaClient();

const LOW_BATTERY_PERCENT = 15;
// Where people were is kept only this long.
const VISIT_KEEP_MS = 14 * 24 * 60 * 60_000;
// The map shows a day of trail; a second day covers "since yesterday evening" and no more.
const TRAIL_KEEP_MS = 2 * 24 * 60 * 60_000;
const ERRAND_KEEP_MS = 7 * 24 * 60 * 60_000;
const TRIP_KEEP_MS = 3 * 60 * 60_000;
// Ended share links are listed for a while (a locked one for a day), then forgotten.
const SHARE_LINK_KEEP_MS = 30 * 24 * 60 * 60_000;

// Parents hear about a family member's phone, other than their own.
async function parentsOf(tenantId: string, exceptUserId: string) {
  return prisma.user.findMany({
    where: { tenantId, isActive: true, isAdmin: true, id: { not: exceptUserId } },
    select: { id: true, email: true, notifyPrefs: true, locale: true },
  });
}

async function runForTenant(tenantId: string) {
  const now = Date.now();

  // Sharing that was set to end has ended: forget the position, as if the member had stopped.
  // shareUntil stays in the past, so a phone that wakes up later is told to stop instead of carrying on with no end.
  const expired = await prisma.locationSettings.findMany({ where: { shareUntil: { lte: new Date(now) }, user: { tenantId, location: { isNot: null } } }, select: { userId: true } });
  for (const { userId } of expired) {
    await prisma.locationPoint.deleteMany({ where: { userId } });
    await prisma.placeVisit.updateMany({ where: { userId, leftAt: null }, data: { leftAt: new Date(now) } });
    await prisma.userLocation.deleteMany({ where: { userId } });
    await prisma.locationSettings.update({ where: { userId }, data: { lowBatteryAlertedAt: null } });
  }

  const rows = await prisma.userLocation.findMany({
    where: { user: { tenantId, isActive: true } },
    include: { user: { select: { id: true, displayName: true, locationSettings: true } } },
  });

  // A phone that stops reporting isn't announced: the map already shows how old a position is,
  // and a phone left on a desk or switched off for the night isn't news.
  let lowBattery = 0;
  for (const row of rows) {
    const { user } = row;
    const settings = user.locationSettings;
    if (settings?.mode === 'paused') continue;
    const age = now - row.updatedAt.getTime();

    if (row.battery !== null && row.battery <= LOW_BATTERY_PERCENT && row.charging !== true && age <= FRESH_LOCATION_MS && !settings?.lowBatteryAlertedAt) {
      const percent = row.battery;
      for (const parent of await parentsOf(tenantId, user.id)) {
        await notifyUser(prisma, parent, 'deviceAlerts', { ...notificationText.lowBattery(parent.locale, user.displayName, percent), url: `${APP_BASE_URL}/locator` });
      }
      await prisma.locationSettings.upsert({ where: { userId: user.id }, update: { lowBatteryAlertedAt: new Date(now) }, create: { userId: user.id, lowBatteryAlertedAt: new Date(now) } });
      lowBattery += 1;
    }
  }

  // Housekeeping: trips nobody finished, old visits and errands.
  const abandoned = await prisma.userLocation.findMany({ where: { user: { tenantId }, tripEtaAt: { lt: new Date(now - TRIP_KEEP_MS) } }, select: { userId: true, updatedAt: true } });
  for (const { userId, updatedAt } of abandoned) {
    await prisma.userLocation.update({ where: { userId }, data: { tripPlaceId: null, tripMode: null, tripEtaAt: null, updatedAt } });
  }
  // A stay still going on is where the member is now, however long ago it began.
  await prisma.placeVisit.deleteMany({ where: { user: { tenantId }, leftAt: { lt: new Date(now - VISIT_KEEP_MS) } } });
  await prisma.locationPoint.deleteMany({ where: { user: { tenantId }, at: { lt: new Date(now - TRAIL_KEEP_MS) } } });
  await prisma.errand.deleteMany({
    where: { tenantId, OR: [{ status: 'open', createdAt: { lt: new Date(now - ERRAND_KEEP_MS) } }, { status: 'done', doneAt: { lt: new Date(now - 24 * 60 * 60_000) } }] },
  });

  if (expired.length || lowBattery) console.log('[worker:location-watch] tenant done', { tenantId, expired: expired.length, lowBattery });
}

async function cleanShareLinks(tenantId: string) {
  const now = Date.now();
  await prisma.locationShareView.deleteMany({ where: { link: { tenantId }, expiresAt: { lte: new Date(now) } } });
  const before = new Date(now - SHARE_LINK_KEEP_MS);
  await prisma.locationShareLink.deleteMany({ where: { tenantId, OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] } });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) {
    await runForTenant(tenant.id);
    await cleanShareLinks(tenant.id);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
