import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Place } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  BLUR_RADIUS_M,
  MAX_PLACE_ACCURACY_M,
  MOVING_MPS,
  PLACE_EXIT_FACTOR,
  blurLocation,
  choreName,
  distanceM,
  notificationText,
  tripEtaMinutes,
  type LocationReport,
  type LocationSettings,
  type LocateInput,
  type PokeInput,
  type TripInput,
} from '@chorly/shared';
import type { RequestUser } from '../common/session/session.types';
import { PrismaService } from '../prisma.service';
import { PushService } from '../push/push.service';
import { ErrandsService } from './errands.service';

const TZ = process.env.TIMEZONE || 'Asia/Jerusalem';
// Someone coming home or to a store again within this long doesn't get its list twice.
const WELCOME_COOLDOWN_MS = 3 * 60 * 60_000;
// The same person can't be poked by the same member more often than this.
const POKE_COOLDOWN_MS = 20_000;
// A fix older than this when it arrives isn't kept, and a newer one is never replaced by an older one.
const MAX_FIX_AGE_MS = 10 * 60_000;
// While the phone has reported within this long, a browser elsewhere doesn't move the person.
const NATIVE_PRIORITY_MS = 15 * 60_000;
// A good recent fix isn't replaced by a much vaguer one (a wifi or cell guess after GPS).
const VAGUE_WINDOW_MS = 3 * 60_000;
const VAGUE_M = 150;
const VAGUE_FACTOR = 4;
// Faster than this between two fixes is a bad fix, not a trip: nobody in the family flies between reports.
const JUMP_WINDOW_MS = 5 * 60_000;
const MAX_PLAUSIBLE_MPS = 85;
// A trail point every this far or this long, from fixes at least this good; shown for the last day.
const TRAIL_STEP_M = 40;
const TRAIL_STEP_MS = 10 * 60_000;
const TRAIL_ACCURACY_M = 100;
const TRAIL_SHOW_MS = 24 * 60 * 60_000;
// "Check in now" can't be asked of the same person more often than this.
const LOCATE_COOLDOWN_MS = 30_000;
// Speed worked out from two fixes, when the device didn't say: only between fixes good enough to trust.
const DERIVE_SPEED_MIN_MS = 5_000;
const DERIVE_SPEED_MAX_MS = 2 * 60_000;
const DERIVE_SPEED_ACCURACY_M = 50;

type PrevFix = { lat: number; lng: number; accuracy: number | null; updatedAt: Date; source: string | null };

// Why a report shouldn't move the person on the map, or null when it should. Bad fixes are what made
// people jump across town for a moment: a stale fix delivered late, a wifi guess after a GPS fix,
// a laptop's rough position overriding the phone in a pocket.
// A blurred row holds the blurred point, so `positions` is off then: it says nothing about how far the phone moved.
function rejectReason(prev: PrevFix | null, next: { lat: number; lng: number; accuracy: number | null; fixAt: Date; source: string }, now: Date, positions: boolean) {
  if (now.getTime() - next.fixAt.getTime() > MAX_FIX_AGE_MS) return 'too_old';
  if (!prev) return null;
  const sincePrev = next.fixAt.getTime() - prev.updatedAt.getTime();
  if (sincePrev <= 0) return 'out_of_order';
  if (prev.source === 'native' && next.source === 'web' && now.getTime() - prev.updatedAt.getTime() < NATIVE_PRIORITY_MS) return 'phone_is_reporting';
  if (!positions) return null;
  if (
    next.accuracy !== null &&
    sincePrev < VAGUE_WINDOW_MS &&
    next.accuracy > VAGUE_M &&
    next.accuracy > (prev.accuracy ?? VAGUE_M) * VAGUE_FACTOR
  ) return 'too_vague';
  if (sincePrev < JUMP_WINDOW_MS) {
    // The two fixes' uncertainty is distance that may not have been travelled.
    const moved = Math.max(0, distanceM(prev, next) - (prev.accuracy ?? 0) - (next.accuracy ?? 0));
    if (moved / (sincePrev / 1000) > MAX_PLAUSIBLE_MPS) return 'implausible_jump';
  }
  return null;
}

// Browsers often send no speed; two good fixes a little apart say it well enough.
function derivedSpeed(prev: PrevFix | null, next: { lat: number; lng: number; accuracy: number | null; fixAt: Date }) {
  if (!prev || prev.accuracy === null || next.accuracy === null) return null;
  if (prev.accuracy > DERIVE_SPEED_ACCURACY_M || next.accuracy > DERIVE_SPEED_ACCURACY_M) return null;
  const ms = next.fixAt.getTime() - prev.updatedAt.getTime();
  if (ms < DERIVE_SPEED_MIN_MS || ms > DERIVE_SPEED_MAX_MS) return null;
  return distanceM(prev, next) / (ms / 1000);
}

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
  heading: number | null;
  placeId: string | null;
  placeSince: Date | null;
  trip: { placeId: string; mode: 'walk' | 'drive'; etaAt: Date | null } | null;
  blurRadiusM: number | null;
};

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private readonly pokes = new Map<string, number>();
  private readonly locates = new Map<string, number>();

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
        return [{ ...base, lat: null, lng: null, accuracy: null, battery: null, charging: null, speed: null, heading: null, placeId: null, placeSince: null, trip: null, blurRadiusM: null }];
      }
      return [
        {
          ...base,
          lat: row.lat,
          lng: row.lng,
          accuracy: mode === 'blurred' ? null : row.accuracy,
          battery: row.battery,
          charging: row.charging,
          // Speed would let a blurred member be followed along the street. Being at one of the
          // family's places stays visible: arrival alerts already say so in every mode.
          speed: mode === 'blurred' ? null : row.speed,
          heading: mode === 'blurred' ? null : row.heading,
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
    const shareUntil = settings?.shareUntil && settings.shareUntil > new Date() ? settings.shareUntil : null;
    return { mode: settings?.mode ?? 'exact', shareUntil, recap: settings?.recap ?? false, trail: settings?.trail ?? true };
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

    // The fix is dated by when it was taken, not when it got here: a phone that was offline
    // shouldn't present a position from minutes ago as live.
    const fixAt = new Date(now.getTime() - (report.ageMs ?? 0));
    const accuracy = report.accuracy ?? null;
    const source = report.source ?? 'web';
    const positions = mode !== 'blurred';
    const rejected = rejectReason(prev, { ...exact, accuracy, fixAt, source }, now, positions);
    if (rejected) {
      this.logger.debug(`ignored a report from ${user.id}: ${rejected}`);
      return { sharing: true, mode };
    }

    // A vague fix could be on either side of a boundary, so it never moves anyone in or out.
    const accurate = accuracy === null || accuracy <= MAX_PLACE_ACCURACY_M;
    const prevPlaceId = prev?.placeId ?? null;
    const placeId = accurate ? insidePlace(places, exact, prevPlaceId) : prevPlaceId;
    const changed = placeId !== prevPlaceId;

    // The estimate follows the person; it ends when they get there.
    const tripPlace = prev?.tripPlaceId && prev.tripMode && prev.tripPlaceId !== placeId ? places.find((p) => p.id === prev.tripPlaceId) : undefined;
    const trip = tripPlace && prev?.tripMode
      ? { tripPlaceId: tripPlace.id, tripMode: prev.tripMode, tripEtaAt: new Date(fixAt.getTime() + tripEtaMinutes(exact, tripPlace, prev.tripMode) * 60_000) }
      : { tripPlaceId: null, tripMode: null, tripEtaAt: null };

    const reportedSpeed = report.speed != null && report.speed >= 0 ? report.speed : null;
    const speed = reportedSpeed ?? (positions ? derivedSpeed(prev, { ...exact, accuracy, fixAt }) : null);
    // A heading means nothing for someone standing still: phones make one up from jitter.
    const heading = report.heading != null && (speed ?? 0) >= MOVING_MPS ? report.heading : null;
    const data = {
      lat: shown.lat,
      lng: shown.lng,
      accuracy,
      battery: report.battery ?? null,
      charging: report.charging ?? null,
      speed,
      heading,
      source,
      placeId,
      placeSince: placeId ? (changed || !prev?.placeSince ? fixAt : prev.placeSince) : null,
      ...trip,
      updatedAt: fixAt,
    };
    await this.prisma.userLocation.upsert({ where: { userId: user.id }, update: data, create: { userId: user.id, ...data } });

    if (mode === 'exact' && settings?.trail !== false && (accuracy === null || accuracy <= TRAIL_ACCURACY_M)) {
      await this.addTrailPoint(user.id, { ...exact, accuracy, speed, at: fixAt });
    }

    // A recovered battery ends a "low battery" alert, so the next drop is announced again.
    const recovered = report.charging === true || (report.battery ?? 0) > 20;
    if (settings?.lowBatteryAlertedAt && recovered) {
      await this.prisma.locationSettings.update({ where: { userId: user.id }, data: { lowBatteryAlertedAt: null } });
    }

    // Side effects run after the response: the phone shouldn't wait on push services.
    // The first report of a session only records where the member is, it doesn't announce it.
    if (changed) this.onPlaceChange(user, prevPlaceId, placeId, places, !!prev).catch((err) => this.logger.warn(`place change failed: ${err?.message}`));
    this.errands.remindNearby(user, exact).catch((err) => this.logger.warn(`errand reminders failed: ${err?.message}`));
    return { sharing: true, mode };
  }

  private async addTrailPoint(userId: string, point: { lat: number; lng: number; accuracy: number | null; speed: number | null; at: Date }) {
    const last = await this.prisma.locationPoint.findFirst({ where: { userId }, orderBy: { at: 'desc' } });
    if (last && distanceM(last, point) < TRAIL_STEP_M && point.at.getTime() - last.at.getTime() < TRAIL_STEP_MS) return;
    await this.prisma.locationPoint.create({ data: { userId, ...point } });
  }

  // Where a family member went over the last day, oldest first. Only while they share their exact
  // position with the trail on: Nearby would give the street away, and paused means paused.
  async trail(tenantId: string, userId: string) {
    const target = await this.prisma.user.findFirst({ where: { id: userId, tenantId, isActive: true }, include: { locationSettings: true, location: { select: { userId: true } } } });
    if (!target) throw new NotFoundException('User not found');
    const settings = target.locationSettings;
    if (!target.location || (settings && (settings.mode !== 'exact' || !settings.trail))) return [];
    if (settings?.shareUntil && settings.shareUntil <= new Date()) return [];
    return this.prisma.locationPoint.findMany({
      where: { userId, at: { gte: new Date(Date.now() - TRAIL_SHOW_MS) } },
      orderBy: { at: 'asc' },
      select: { lat: true, lng: true, speed: true, at: true },
    });
  }

  // "Check in now": a silent push asks the member's Android app for a fresh position, which then
  // arrives the usual way. Only for someone who is sharing and not paused.
  async locate(user: RequestUser, body: LocateInput) {
    if (body.userId === user.id) throw new BadRequestException('Cannot locate yourself');
    const target = await this.prisma.user.findFirst({ where: { id: body.userId, tenantId: user.tenantId, isActive: true }, include: { locationSettings: true, location: { select: { userId: true } } } });
    if (!target) throw new NotFoundException('User not found');
    if (!target.location || target.locationSettings?.mode === 'paused') throw new BadRequestException('not_sharing');
    const key = `${user.id}:${target.id}`;
    if (Date.now() - (this.locates.get(key) ?? 0) < LOCATE_COOLDOWN_MS) throw new HttpException('locate_cooldown', HttpStatus.TOO_MANY_REQUESTS);
    this.locates.set(key, Date.now());
    const sent = await this.push.sendLocate(target.id);
    if (sent === 0) throw new BadRequestException('no_app');
    return { ok: true };
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

    const earlier = to.kind === 'home' || to.kind === 'store'
      ? await this.prisma.placeVisit.findFirst({
          where: { userId: user.id, place: { kind: to.kind }, arrivedAt: { gte: new Date(now.getTime() - WELCOME_COOLDOWN_MS) } },
        })
      : null;
    const visit = await this.prisma.placeVisit.create({ data: { userId: user.id, placeId: to.id } });
    if (announce) await this.announce(user, 'arrived', to);
    await this.reward(user, to, visit.id);
    if (announce && to.kind === 'home' && !earlier) await this.welcomeHome(user);
    if (announce && to.kind === 'store' && !earlier) await this.remindShopping(user, to);
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

  private async remindShopping(user: RequestUser, place: Place) {
    const count = await this.prisma.shoppingItem.count({ where: { tenantId: user.tenantId, state: 'needed' } });
    if (count === 0) return;
    await this.push.sendToUsers([user.id], 'shopping', (locale) => ({ ...notificationText.shoppingAtStore(locale, place.name, count), url: '/shopping' }));
  }

  async stop(userId: string) {
    await this.prisma.placeVisit.updateMany({ where: { userId, leftAt: null }, data: { leftAt: new Date() } });
    await this.prisma.userLocation.deleteMany({ where: { userId } });
    await this.prisma.locationPoint.deleteMany({ where: { userId } });
    // A pause belongs to one sharing session: the next one starts out live.
    await this.prisma.locationSettings.updateMany({ where: { userId }, data: { shareUntil: null, lowBatteryAlertedAt: null } });
    await this.prisma.locationSettings.updateMany({ where: { userId, mode: 'paused' }, data: { mode: 'exact' } });
  }

  async setSettings(userId: string, body: LocationSettings) {
    const before = await this.prisma.locationSettings.findUnique({ where: { userId } });
    const data: Prisma.LocationSettingsUncheckedUpdateInput = {};
    if (body.mode) data.mode = body.mode;
    if (body.durationMinutes !== undefined) data.shareUntil = body.durationMinutes === null ? null : new Date(Date.now() + body.durationMinutes * 60_000);
    if (body.recap !== undefined) data.recap = body.recap;
    if (body.trail !== undefined) data.trail = body.trail;
    await this.prisma.locationSettings.upsert({ where: { userId }, update: data, create: { ...(data as Prisma.LocationSettingsUncheckedCreateInput), userId } });

    // The trail goes with anything that shows less than the exact position, and with the trail turned off.
    if (body.trail === false || body.mode === 'paused' || body.mode === 'blurred') {
      await this.prisma.locationPoint.deleteMany({ where: { userId } });
    }
    if (body.mode === 'paused') {
      await this.prisma.placeVisit.updateMany({ where: { userId, leftAt: null }, data: { leftAt: new Date() } });
      await this.prisma.userLocation.updateMany({
        where: { userId },
        data: { placeId: null, placeSince: null, tripPlaceId: null, tripMode: null, tripEtaAt: null },
      });
    } else if (body.mode && before?.mode === 'paused') {
      // Coming back starts a new session: the first report says where the member is, it doesn't announce an arrival.
      await this.prisma.userLocation.deleteMany({ where: { userId } });
    } else if (body.mode === 'blurred') {
      // Don't wait for the next report to take the street out of view.
      const row = await this.prisma.userLocation.findUnique({ where: { userId } });
      if (row) await this.prisma.userLocation.update({ where: { userId }, data: { ...blurLocation(row), speed: null, heading: null, updatedAt: row.updatedAt } });
    }
    return this.mine(userId);
  }

  async startTrip(user: RequestUser, body: TripInput) {
    const [place, row, settings] = await Promise.all([
      this.prisma.place.findFirst({ where: { id: body.placeId, tenantId: user.tenantId } }),
      this.prisma.userLocation.findUnique({ where: { userId: user.id } }),
      this.prisma.locationSettings.findUnique({ where: { userId: user.id } }),
    ]);
    if (!place) throw new NotFoundException('Place not found');
    if (!row || settings?.mode === 'paused') throw new BadRequestException('share_first');
    if (row.placeId === place.id) throw new BadRequestException('already_there');
    const minutes = tripEtaMinutes(row, place, body.mode);
    await this.prisma.userLocation.update({
      where: { userId: user.id },
      // updatedAt is how old the position is, and a trip doesn't make it any newer.
      data: { tripPlaceId: place.id, tripMode: body.mode, tripEtaAt: new Date(Date.now() + minutes * 60_000), updatedAt: row.updatedAt },
    });
    const members = await this.prisma.user.findMany({ where: { tenantId: user.tenantId, isActive: true, id: { not: user.id } }, select: { id: true } });
    void this.push.sendToUsers(members.map((m) => m.id), 'placeAlerts', (locale) => ({ ...notificationText.tripStarted(locale, user.displayName, place.name, minutes), url: '/locator' }));
    return { minutes };
  }

  async endTrip(userId: string) {
    const row = await this.prisma.userLocation.findUnique({ where: { userId } });
    if (row) await this.prisma.userLocation.update({ where: { userId }, data: { tripPlaceId: null, tripMode: null, tripEtaAt: null, updatedAt: row.updatedAt } });
  }

  async poke(user: RequestUser, body: PokeInput) {
    if (body.userId === user.id) throw new BadRequestException('Cannot poke yourself');
    const target = await this.prisma.user.findFirst({ where: { id: body.userId, tenantId: user.tenantId, isActive: true }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    const key = `${user.id}:${target.id}`;
    const last = this.pokes.get(key) ?? 0;
    if (Date.now() - last < POKE_COOLDOWN_MS) throw new HttpException('poke_cooldown', HttpStatus.TOO_MANY_REQUESTS);
    this.pokes.set(key, Date.now());
    await this.push.sendToUsers([target.id], 'pokes', (locale) => ({ ...notificationText.poke(locale, user.displayName, body.kind), url: '/locator' }));
    return { ok: true };
  }
}
