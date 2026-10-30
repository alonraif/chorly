import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ERRAND_REMINDER_M, FRESH_LOCATION_MS, distanceM, notificationText, type ErrandInput } from '@chorly/shared';
import type { RequestUser } from '../common/session/session.types';
import { PrismaService } from '../prisma.service';
import { PushService } from '../push/push.service';

const ERRANDS_URL = '/locator?sheet=errands';

@Injectable()
export class ErrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // Who could take an errand right now: members whose position is recent and visible.
  // A member sharing only their neighbourhood still counts, from the middle of it.
  private async candidates(tenantId: string) {
    const rows = await this.prisma.userLocation.findMany({
      where: { user: { tenantId, isActive: true }, updatedAt: { gte: new Date(Date.now() - FRESH_LOCATION_MS) } },
      include: { user: { select: { locationSettings: true } } },
    });
    const now = new Date();
    return rows.filter(({ user: { locationSettings: settings } }) => settings?.mode !== 'paused' && !(settings?.shareUntil && settings.shareUntil <= now));
  }

  // Whoever asked for it knows already: the nearest of the others is the one to nudge.
  private closest(rows: Array<{ userId: string; lat: number; lng: number }>, point: { lat: number; lng: number }, authorId: string) {
    let best: { userId: string; distanceM: number } | null = null;
    for (const row of rows) {
      if (row.userId === authorId) continue;
      const d = distanceM(point, row);
      if (!best || d < best.distanceM) best = { userId: row.userId, distanceM: Math.round(d) };
    }
    return best;
  }

  async list(tenantId: string) {
    const [errands, rows] = await Promise.all([
      this.prisma.errand.findMany({ where: { tenantId, status: 'open' }, orderBy: { createdAt: 'desc' } }),
      this.candidates(tenantId),
    ]);
    return errands.map((e) => ({
      id: e.id,
      title: e.title,
      note: e.note,
      lat: e.lat,
      lng: e.lng,
      createdById: e.createdById,
      claimedById: e.claimedById,
      createdAt: e.createdAt,
      closest: e.claimedById ? null : this.closest(rows, e, e.createdById),
    }));
  }

  async create(user: RequestUser, body: ErrandInput) {
    const rows = await this.candidates(user.tenantId);
    const closest = this.closest(rows, body, user.id);
    // Nobody needs "right nearby" for a pin dropped where they stand, or right after being told they're closest.
    const remindedIds = rows.filter((row) => (row.userId === user.id || row.userId === closest?.userId) && distanceM(body, row) <= ERRAND_REMINDER_M).map((row) => row.userId);
    const errand = await this.prisma.errand.create({
      data: { tenantId: user.tenantId, createdById: user.id, title: body.title, note: body.note ?? null, lat: body.lat, lng: body.lng, remindedIds },
    });
    if (closest) void this.push.sendToUsers([closest.userId], 'errands', (locale) => ({ ...notificationText.errandClosest(locale, errand.title), url: ERRANDS_URL }));
    return { id: errand.id };
  }

  // Whoever pinned it wants to know it's being handled.
  private tellAuthor(errand: { createdById: string; title: string }, actor: RequestUser, text: typeof notificationText.errandDone) {
    if (errand.createdById === actor.id) return;
    void this.push.sendToUsers([errand.createdById], 'errands', (locale) => ({ ...text(locale, actor.displayName, errand.title), url: ERRANDS_URL }));
  }

  private async open(tenantId: string, id: string) {
    const errand = await this.prisma.errand.findFirst({ where: { id, tenantId, status: 'open' } });
    if (!errand) throw new NotFoundException('Errand not found');
    return errand;
  }

  async claim(user: RequestUser, id: string) {
    const errand = await this.open(user.tenantId, id);
    // In the query itself, so two people tapping at once can't both get it.
    const { count } = await this.prisma.errand.updateMany({
      where: { id, status: 'open', OR: [{ claimedById: null }, { claimedById: user.id }] },
      data: { claimedById: user.id },
    });
    if (count === 0) throw new ConflictException('errand_taken');
    if (errand.claimedById !== user.id) this.tellAuthor(errand, user, notificationText.errandClaimed);
    return { ok: true };
  }

  async release(user: RequestUser, id: string) {
    const errand = await this.open(user.tenantId, id);
    if (errand.claimedById !== user.id && !user.isAdmin) throw new ForbiddenException('not_your_errand');
    // Everyone nearby can be reminded again once nobody holds it.
    await this.prisma.errand.update({ where: { id }, data: { claimedById: null, remindedIds: [] } });
    return { ok: true };
  }

  async done(user: RequestUser, id: string) {
    const errand = await this.open(user.tenantId, id);
    if (errand.claimedById && errand.claimedById !== user.id && !user.isAdmin) throw new ForbiddenException('not_your_errand');
    await this.prisma.errand.update({ where: { id }, data: { status: 'done', doneAt: new Date(), claimedById: user.id } });
    this.tellAuthor(errand, user, notificationText.errandDone);
    return { ok: true };
  }

  async remove(user: RequestUser, id: string) {
    const errand = await this.open(user.tenantId, id);
    if (errand.createdById !== user.id && !user.isAdmin) throw new ForbiddenException('not_your_errand');
    await this.prisma.errand.delete({ where: { id } });
    return { ok: true };
  }

  // Passing close to an open errand reminds you once: the person who took it, or anyone if nobody has.
  async remindNearby(user: RequestUser, point: { lat: number; lng: number }) {
    const errands = await this.prisma.errand.findMany({ where: { tenantId: user.tenantId, status: 'open' } });
    for (const errand of errands) {
      if (errand.remindedIds.includes(user.id)) continue;
      if (errand.claimedById && errand.claimedById !== user.id) continue;
      if (distanceM(point, errand) > ERRAND_REMINDER_M) continue;
      await this.prisma.errand.update({ where: { id: errand.id }, data: { remindedIds: { push: user.id } } });
      void this.push.sendToUsers([user.id], 'errands', (locale) => ({ ...notificationText.errandNearby(locale, errand.title), url: ERRANDS_URL }));
    }
  }
}
