import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Place } from '@prisma/client';
import { distanceM, type PlaceInput, type UpdatePlace } from '@chorly/shared';
import { PrismaService } from '../prisma.service';

// No reward and a reward of nothing are the same thing.
function rewardOf(amount: string | null | undefined) {
  return amount && Number(amount) > 0 ? new Prisma.Decimal(amount) : null;
}

@Injectable()
export class PlacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const places = await this.prisma.place.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    return places.map((p) => ({ ...p, rewardAmount: p.rewardAmount?.toString() ?? null }));
  }

  async create(tenantId: string, body: PlaceInput) {
    const place = await this.prisma.place.create({
      data: {
        tenantId,
        name: body.name,
        kind: body.kind,
        note: body.note || null,
        lat: body.lat,
        lng: body.lng,
        radiusM: body.radiusM,
        rewardAmount: rewardOf(body.rewardAmount),
      },
    });
    await this.seatPresent(tenantId, place);
    return { id: place.id };
  }

  // Whoever already stands there is simply there: a new place shouldn't announce them as arriving.
  // A blurred member's real position isn't kept, so they're found out at their next report.
  private async seatPresent(tenantId: string, place: Place) {
    const rows = await this.prisma.userLocation.findMany({
      where: { placeId: null, user: { tenantId, isActive: true, OR: [{ locationSettings: null }, { locationSettings: { mode: 'exact' } }] } },
    });
    const now = new Date();
    for (const row of rows) {
      if (distanceM(row, place) > place.radiusM) continue;
      await this.prisma.userLocation.update({ where: { userId: row.userId }, data: { placeId: place.id, placeSince: now, updatedAt: row.updatedAt } });
      await this.prisma.placeVisit.create({ data: { userId: row.userId, placeId: place.id } });
    }
  }

  private async get(tenantId: string, id: string) {
    const place = await this.prisma.place.findFirst({ where: { id, tenantId } });
    if (!place) throw new NotFoundException('Place not found');
    return place;
  }

  async update(tenantId: string, id: string, body: UpdatePlace) {
    await this.get(tenantId, id);
    const place = await this.prisma.place.update({
      where: { id },
      data: {
        name: body.name,
        kind: body.kind,
        note: body.note === undefined ? undefined : body.note || null,
        lat: body.lat,
        lng: body.lng,
        radiusM: body.radiusM,
        rewardAmount: body.rewardAmount === undefined ? undefined : rewardOf(body.rewardAmount),
      },
    });
    await this.seatPresent(tenantId, place);
    return { ok: true };
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.place.delete({ where: { id } });
    return { ok: true };
  }
}
