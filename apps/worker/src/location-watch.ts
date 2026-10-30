import { PrismaClient } from '@prisma/client';
import { FRESH_LOCATION_MS, notificationText } from '@chorly/shared';
import { APP_BASE_URL, QUIET_HOURS, TENANT_ID_FILTER } from './lib/config';
import { notifyUser } from './lib/notify';
import { inQuietHours } from './lib/time';

const prisma = new PrismaClient();

const LOW_BATTERY_PERCENT = 15;
// A phone that sends nothing for this long is worth a look...
const QUIET_AFTER_MS = 45 * 60_000;
// ...but not days later: by then it is switched off or left behind on purpose.
const QUIET_GIVE_UP_MS = 24 * 60 * 60_000;
// Where people were is kept only this long.
const VISIT_KEEP_MS = 14 * 24 * 60 * 60_000;
const ERRAND_KEEP_MS = 7 * 24 * 60 * 60_000;
const TRIP_KEEP_MS = 3 * 60 * 60_000;

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
  const expired = await prisma.locationSettings.findMany({ where: { shareUntil: { lte: new Date(now) }, user: { tenantId } }, select: { userId: true } });
  for (const { userId } of expired) {
    await prisma.placeVisit.updateMany({ where: { userId, leftAt: null }, data: { leftAt: new Date(now) } });
    await prisma.userLocation.deleteMany({ where: { userId } });
    await prisma.locationSettings.update({ where: { userId }, data: { shareUntil: null, quietAlertedAt: null, lowBatteryAlertedAt: null } });
  }

  const rows = await prisma.userLocation.findMany({
    where: { user: { tenantId, isActive: true } },
    include: { user: { select: { id: true, displayName: true, locationSettings: true, fcmTokens: { select: { id: true }, take: 1 } } } },
  });

  let lowBattery = 0;
  let quiet = 0;
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

    // Only the Android app keeps reporting in the background, so only its owners can go quiet unexpectedly.
    const nativeOwner = user.fcmTokens.length > 0;
    if (nativeOwner && age >= QUIET_AFTER_MS && age <= QUIET_GIVE_UP_MS && !settings?.quietAlertedAt && !inQuietHours(QUIET_HOURS)) {
      const minutes = Math.round(age / 60_000);
      for (const parent of await parentsOf(tenantId, user.id)) {
        await notifyUser(prisma, parent, 'deviceAlerts', { ...notificationText.wentQuiet(parent.locale, user.displayName, minutes), url: `${APP_BASE_URL}/locator` });
      }
      await prisma.locationSettings.upsert({ where: { userId: user.id }, update: { quietAlertedAt: new Date(now) }, create: { userId: user.id, quietAlertedAt: new Date(now) } });
      quiet += 1;
    }
  }

  // Housekeeping: trips nobody finished, old visits and errands.
  await prisma.userLocation.updateMany({
    where: { user: { tenantId }, tripEtaAt: { lt: new Date(now - TRIP_KEEP_MS) } },
    data: { tripPlaceId: null, tripMode: null, tripEtaAt: null },
  });
  await prisma.placeVisit.deleteMany({ where: { user: { tenantId }, arrivedAt: { lt: new Date(now - VISIT_KEEP_MS) } } });
  await prisma.errand.deleteMany({
    where: { tenantId, OR: [{ status: 'open', createdAt: { lt: new Date(now - ERRAND_KEEP_MS) } }, { status: 'done', doneAt: { lt: new Date(now - 24 * 60 * 60_000) } }] },
  });

  if (expired.length || lowBattery || quiet) console.log('[worker:location-watch] tenant done', { tenantId, expired: expired.length, lowBattery, quiet });
}

async function main() {
  const tenants = await prisma.tenant.findMany({ where: TENANT_ID_FILTER ? { id: TENANT_ID_FILTER } : undefined });
  for (const tenant of tenants) await runForTenant(tenant.id);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
