import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Place } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  BLUR_RADIUS_M,
  MAX_PLACE_ACCURACY_M,
  PLACE_EXIT_FACTOR,
  blurLocation,
  choreName,
  distanceM,
  notificationText,
  tripEtaMinutes,
  type LocationReport,
  type LocationSettings,
  type PokeInput,
  type TripInput,
} from '@chorly/shared';
import type { RequestUser } from '../common/session/session.types';
import { PrismaService } from '../prisma.service';
import { PushService } from '../push/push.service';
import { ErrandsService } from './errands.service';

const TZ = process.env.TIMEZONE || 'Asia/Jerusalem';
// Someone coming home again within this long doesn't get the "welcome home" list twice.
const WELCOME_COOLDOWN_MS = 3 * 60 * 60_000;
// The same person can't be poked by the same member more often than this.
const POKE_COOLDOWN_MS = 20_000;

// The place the point is inside. Someone already in a place stays in it a little past its edge,
// so GPS jitter on the boundary doesn't announce a leave and an arrival every few seconds.
function insidePlace(places: Place[], point: { lat: number; lng: number }, currentId: string | null) {
  const current = places.find((p) => p.id === currentId);
  if (current && distanceM(point, current) <= current.radiusM * PLACE_EXIT_FACTOR) return current.id;
  let best: { id: string; d: number } | null = null;
  for (const place of places) {
    const d = distanceM(point, place);
    if (d <= place.radiusM && (!best || d < best.d)) best = { id: place.id, d };
  }
  return best?.id ?? null;
}

export type LocationEntry = {
  userId: string;
  mode: 'exact' | 'blurred' | 'paused';
  shareUntil: Date | null;
  updatedAt: Date;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  battery: number | null;
  charging: boolean | null;
  speed: number | null;
  placeId: string | null;
  placeSince: Date | null;
  trip: { placeId: string; mode: 'walk' | 'drive'; etaAt: Date | null } | null;
  blurRadiusM: number | null;
};

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private readonly pokes = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly errands: ErrandsService,
  ) {}

  // What the family sees of each member who shares. A paused member shows as paused with no position.
  async entries(tenantId: string): Promise<LocationEntry[]> {
    const now = Date.now();
    const rows = await this.prisma.userLocation.findMany({
      where: { user: { tenantId, isActive: true } },
      include: { user: { select: { locationSettings: true } } },
    });
    return rows.flatMap((row): LocationEntry[] => {
      const settings = row.user.locationSettings;
      if (settings?.shareUntil && settings.shareUntil.getTime() <= now) return [];
      const mode = settings?.mode ?? 'exact';
      const base = { userId: row.userId, mode, shareUntil: settings?.shareUntil ?? null, updatedAt: row.updatedAt };
      if (mode === 'paused') {
        return [{ ...base, lat: null, lng: null, accuracy: null, battery: null, charging: null, speed: null, placeId: null, placeSince: null, trip: null, blurRadiusM: null }];
      }
      return [
        {
          ...base,
          lat: row.lat,
          lng: row.lng,
          accuracy: row.accuracy,
          battery: row.battery,
          charging: row.charging,
          // Speed and a place name would let a blurred member be followed along the street.
          speed: mode === 'blurred' ? null : row.speed,
          placeId: row.placeId,
          placeSince: row.placeSince,
          trip: row.tripPlaceId && row.tripMode ? { placeId: row.tripPlaceId, mode: row.tripMode, etaAt: row.tripEtaAt } : null,
          blurRadiusM: mode === 'blurred' ? BLUR_RADIUS_M : null,
        },
      ];
    });
  }

  list(tenantId: string) {
    return this.entries(tenantId);
  }

  async mine(userId: string) {
    const settings = await this.prisma.locationSettings.findUnique({ where: { userId } });
    return { mode: settings?.mode ?? 'exact', shareUntil: settings?.shareUntil ?? null, recap: settings?.recap ?? false };
  }

  async report(user: RequestUser, report: LocationReport) {
    const now = new Date();
    const settings = await this.prisma.locationSettings.findUnique({ where: { userId: user.id } });
    if (settings?.shareUntil && settings.shareUntil <= now) {
      await this.stop(user.id);
      return { sharing: false, mode: 'exact' as const };
    }
    const mode = settings?.mode ?? 'exact';
    if (mode === 'paused') return { sharing: true, mode };

    const exact = { lat: report.lat, lng: report.lng };
    const shown = mode === 'blurred' ? blurLocation(exact) : exact;
    const [prev, places] = await Promise.all([
      this.prisma.userLocation.findUnique({ where: { userId: user.id } }),
      this.prisma.place.findMany({ where: { tenantId: user.tenantId } }),
    ]);

    // A vague fix could be on either side of a boundary, so it never moves anyone in or out.
    const accurate = report.accuracy === undefined || report.accuracy <= MAX_PLACE_ACCURACY_M;
    const prevPlaceId = prev?.placeId ?? null;
    const placeId = accurate ? insidePlace(places, exact, prevPlaceId) : prevPlaceId;
    const changed = placeId !== prevPlaceId;

    // The estimate follows the person; it ends when they get there.
    const tripPlace = prev?.tripPlaceId && prev.tripMode && prev.tripPlaceId !== placeId ? places.find((p) => p.id === prev.tripPlaceId) : undefined;
    const trip = tripPlace && prev?.tripMode
      ? { tripPlaceId: tripPlace.id, tripMode: prev.tripMode, tripEtaAt: new Date(now.getTime() + tripEtaMinutes(exact, tripPlace, prev.tripMode) * 60_000) }
      : { tripPlaceId: null, tripMode: null, tripEtaAt: null };

    const data = {
      lat: shown.lat,
      lng: shown.lng,
      accuracy: report.accuracy ?? null,
      battery: report.battery ?? null,
      charging: report.charging ?? null,
      speed: report.speed != null && report.speed >= 0 ? report.speed : null,
      placeId,
      placeSince: placeId ? (changed || !prev?.placeSince ? now : prev.placeSince) : null,
      ...trip,
    };
    await this.prisma.userLocation.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });

    // A fresh report ends a "went quiet" alert; a recovered battery ends a "low battery" one.
    const recovered = report.charging === true || (report.battery ?? 0) > 20;
    if (settings && (settings.quietAlertedAt || (settings.lowBatteryAlertedAt && recovered))) {
      await this.prisma.locationSettings.update({
        where: { userId: user.id },
        data: { quietAlertedAt: null, ...(recovered ? { lowBatteryAlertedAt: null } : {}) },
      });
    }

    // Side effects run after the response: the phone shouldn't wait on push services.
    // The first report of a session only records where the member is, it doesn't announce it.
    if (changed) this.onPlaceChange(user, prevPlaceId, placeId, places, !!prev).catch((err) => this.logger.warn(`place change failed: ${err?.message}`));
    this.errands.remindNearby(user, exact).catch((err) => this.logger.warn(`errand reminders failed: ${err?.message}`));
    return { sharing: true, mode };
  }

  private async onPlaceChange(user: RequestUser, fromId: string | null, toId: string | null, places: Place[], announce: boolean) {
    const byId = new Map(places.map((p) => [p.id, p]));
    const now = new Date();
    const from = fromId ? byId.get(fromId) : undefined;
    if (fromId) {
      await this.prisma.placeVisit.updateMany({ where: { userId: user.id, placeId: fromId, leftAt: null }, data: { leftAt: now } });
      if (announce && from) await this.announce(user, 'left', from);
    }
    const to = toId ? byId.get(toId) : undefined;
    if (!to) return;

    const earlier = to.kind === 'home'
      ? await this.prisma.placeVisit.findFirst({
          where: { userId: user.id, place: { kind: 'home' }, arrivedAt: { gte: new Date(now.getTime() - WELCOME_COOLDOWN_MS) } },
        })
      : null;
    const visit = await this.prisma.placeVisit.create({ data: { userId: user.id, placeId: to.id } });
    if (announce) await this.announce(user, 'arrived', to);
    await this.reward(user, to, visit.id);
    if (announce && to.kind === 'home' && !earlier) await this.welcomeHome(user);
  }

  private async announce(user: RequestUser, kind: 'arrived' | 'left', place: Place) {
    const members = await this.prisma.user.findMany({ where: { tenantId: user.tenantId, isActive: true, id: { not: user.id } }, select: { id: true } });
    const text = kind === 'arrived' ? notificationText.placeArrived : notificationText.placeLeft;
    await this.push.sendToUsers(members.map((m) => m.id), 'placeAlerts', (locale) => ({ ...text(locale, user.displayName, place.name), url: '/locator' }));
  }

  // The first arrival of the day at a rewarding place pays a child, so a trip to the library earns coins.
  private async reward(user: RequestUser, place: Place, visitId: string) {
    if (!place.rewardAmount || user.role !== 'child') return;
    const since = DateTime.now().setZone(TZ).startOf('day').toUTC().toJSDate();
    const already = await this.prisma.placeVisit.findFirst({ where: { userId: user.id, placeId: place.id, rewarded: true, arrivedAt: { gte: since } } });
    if (already) return;
    await this.prisma.$transaction([
      this.prisma.moneyLedger.create({ data: { tenantId: user.tenantId, userId: user.id, type: 'earn', amount: place.rewardAmount } }),
      this.prisma.placeVisit.update({ where: { id: visitId }, data: { rewarded: true } }),
    ]);
    const amount = place.rewardAmount.toString();
    await this.push.sendToUsers([user.id], null, (locale) => ({ ...notificationText.placeReward(locale, place.name, amount), url: '/child' }));
  }

  private async welcomeHome(user: RequestUser) {
    const day = DateTime.now().setZone(TZ);
    const open = await this.prisma.choreInstance.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'assigned',
        dueAt: { gte: day.startOf('day').toUTC().toJSDate(), lte: day.endOf('day').toUTC().toJSDate() },
        assignments: { some: { userId: user.id } },
        completions: { none: { userId: user.id, undoneAt: null } },
      },
      include: { chore: true },
      orderBy: { dueAt: 'asc' },
    });
    if (open.length === 0) return;
    await this.push.sendToUsers([user.id], 'arrivalNudge', (locale) => ({
      ...notificationText.welcomeHome(locale, user.displayName, open.map((i) => choreName(i.chore, locale))),
      url: '/child',
    }));
  }

  async stop(userId: string) {
    await this.prisma.placeVisit.updateMany({ where: { userId, leftAt: null }, data: { leftAt: new Date() } });
    await this.prisma.userLocation.deleteMany({ where: { userId } });
    // A pause belongs to one sharing session: the next one starts out live.
    await this.prisma.locationSettings.updateMany({ where: { userId }, data: { shareUntil: null, lowBatteryAlertedAt: null, quietAlertedAt: null } });
    await this.prisma.locationSettings.updateMany({ where: { userId, mode: 'paused' }, data: { mode: 'exact' } });
  }

  async setSettings(userId: string, body: LocationSettings) {
    const data: Prisma.LocationSettingsUncheckedUpdateInput = {};
    if (body.mode) data.mode = body.mode;
    if (body.durationMinutes !== undefined) data.shareUntil = body.durationMinutes === null ? null : new Date(Date.now() + body.durationMinutes * 60_000);
    if (body.recap !== undefined) data.recap = body.recap;
    await this.prisma.locationSettings.upsert({ where: { userId }, update: data, create: { ...(data as Prisma.LocationSettingsUncheckedCreateInput), userId } });

    if (body.mode === 'paused') {
      await this.prisma.placeVisit.updateMany({ where: { userId, leftAt: null }, data: { leftAt: new Date() } });
      await this.prisma.userLocation.updateMany({
        where: { userId },
        data: { placeId: null, placeSince: null, tripPlaceId: null, tripMode: null, tripEtaAt: null },
      });
    } else if (body.mode === 'blurred') {
      // Don't wait for the next report to take the street out of view.
      const row = await this.prisma.userLocation.findUnique({ where: { userId } });
      if (row) await this.prisma.userLocation.update({ where: { userId }, data: { ...blurLocation(row), speed: null } });
    }
    return this.mine(userId);
  }

  async startTrip(user: RequestUser, body: TripInput) {
    const [place, row] = await Promise.all([
      this.prisma.place.findFirst({ where: { id: body.placeId, tenantId: user.tenantId } }),
      this.prisma.userLocation.findUnique({ where: { userId: user.id } }),
    ]);
    if (!place) throw new NotFoundException('Place not found');
    if (!row) throw new BadRequestException('Share your location first');
    const minutes = tripEtaMinutes(row, place, body.mode);
    await this.prisma.userLocation.update({
      where: { userId: user.id },
      data: { tripPlaceId: place.id, tripMode: body.mode, tripEtaAt: new Date(Date.now() + minutes * 60_000) },
    });
    const members = await this.prisma.user.findMany({ where: { tenantId: user.tenantId, isActive: true, id: { not: user.id } }, select: { id: true } });
    void this.push.sendToUsers(members.map((m) => m.id), 'placeAlerts', (locale) => ({ ...notificationText.tripStarted(locale, user.displayName, place.name, minutes), url: '/locator' }));
    return { minutes };
  }

  async endTrip(userId: string) {
    await this.prisma.userLocation.updateMany({ where: { userId }, data: { tripPlaceId: null, tripMode: null, tripEtaAt: null } });
  }

  async poke(user: RequestUser, body: PokeInput) {
    if (body.userId === user.id) throw new BadRequestException('Cannot poke yourself');
    const target = await this.prisma.user.findFirst({ where: { id: body.userId, tenantId: user.tenantId, isActive: true }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    const key = `${user.id}:${target.id}`;
    const last = this.pokes.get(key) ?? 0;
    if (Date.now() - last < POKE_COOLDOWN_MS) throw new ForbiddenException('Slow down a little');
    this.pokes.set(key, Date.now());
    await this.push.sendToUsers([target.id], 'pokes', (locale) => ({ ...notificationText.poke(locale, user.displayName, body.kind), url: '/locator' }));
    return { ok: true };
  }
}
