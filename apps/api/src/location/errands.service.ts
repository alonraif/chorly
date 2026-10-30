import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ERRAND_REMINDER_M, FRESH_LOCATION_MS, distanceM, notificationText, type ErrandInput } from '@chorly/shared';
import type { RequestUser } from '../common/session/session.types';
import { PrismaService } from '../prisma.service';
import { PushService } from '../push/push.service';

@Injectable()
export class ErrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // The sharing member nearest to the point, among those whose position is recent and visible.
  // A member sharing only their neighbourhood still counts, from the middle of it.
  async closestTo(tenantId: string, point: { lat: number; lng: number }) {
    const rows = await this.prisma.userLocation.findMany({
      where: { user: { tenantId, isActive: true }, updatedAt: { gte: new Date(Date.now() - FRESH_LOCATION_MS) } },
      include: { user: { select: { locationSettings: true } } },
    });
    let best: { userId: string; distanceM: number } | null = null;
    for (const row of rows) {
      const settings = row.user.locationSettings;
      if (settings?.mode === 'paused' || (settings?.shareUntil && settings.shareUntil <= new Date())) continue;
      const d = distanceM(point, row);
      if (!best || d < best.distanceM) best = { userId: row.userId, distanceM: Math.round(d) };
    }
    return best;
  }

  async list(tenantId: string) {
    const errands = await this.prisma.errand.findMany({ where: { tenantId, status: 'open' }, orderBy: { createdAt: 'desc' } });
    return Promise.all(
      errands.map(async (e) => ({
        id: e.id,
        title: e.title,
        note: e.note,
        lat: e.lat,
        lng: e.lng,
        createdById: e.createdById,
        claimedById: e.claimedById,
        createdAt: e.createdAt,
        closest: e.claimedById ? null : await this.closestTo(tenantId, e),
      })),
    );
  }

  async create(user: RequestUser, body: ErrandInput) {
    const errand = await this.prisma.errand.create({
      data: { tenantId: user.tenantId, createdById: user.id, title: body.title, note: body.note ?? null, lat: body.lat, lng: body.lng, remindedIds: [] },
    });
    const closest = await this.closestTo(user.tenantId, errand);
    if (closest && closest.userId !== user.id) {
      void this.push.sendToUsers([closest.userId], 'errands', (locale) => ({ ...notificationText.errandClosest(locale, errand.title), url: '/locator' }));
    }
    return { id: errand.id };
  }

  private async open(tenantId: string, id: string) {
    const errand = await this.prisma.errand.findFirst({ where: { id, tenantId, status: 'open' } });
    if (!errand) throw new NotFoundException('Errand not found');
    return errand;
  }

  async claim(user: RequestUser, id: string) {
    const errand = await this.open(user.tenantId, id);
    if (errand.claimedById && errand.claimedById !== user.id) throw new ConflictException('Someone else already took this');
    await this.prisma.errand.update({ where: { id }, data: { claimedById: user.id } });
    return { ok: true };
  }

  async release(user: RequestUser, id: string) {
    const errand = await this.open(user.tenantId, id);
    if (errand.claimedById !== user.id && !user.isAdmin) throw new ForbiddenException('Not yours to release');
    // Everyone nearby can be reminded again once nobody holds it.
    await this.prisma.errand.update({ where: { id }, data: { claimedById: null, remindedIds: [] } });
    return { ok: true };
  }

  async done(user: RequestUser, id: string) {
    await this.open(user.tenantId, id);
    await this.prisma.errand.update({ where: { id }, data: { status: 'done', doneAt: new Date(), claimedById: user.id } });
    return { ok: true };
  }

  async remove(user: RequestUser, id: string) {
    const errand = await this.open(user.tenantId, id);
    if (errand.createdById !== user.id && !user.isAdmin) throw new ForbiddenException('Only its author or a parent can remove this');
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
      void this.push.sendToUsers([user.id], 'errands', (locale) => ({ ...notificationText.errandNearby(locale, errand.title), url: '/locator' }));
    }
  }
}
