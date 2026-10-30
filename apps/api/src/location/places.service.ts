import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PlaceInput, UpdatePlace } from '@chorly/shared';
import { PrismaService } from '../prisma.service';

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
        rewardAmount: body.rewardAmount ? new Prisma.Decimal(body.rewardAmount) : null,
      },
    });
    return { id: place.id };
  }

  private async get(tenantId: string, id: string) {
    const place = await this.prisma.place.findFirst({ where: { id, tenantId } });
    if (!place) throw new NotFoundException('Place not found');
    return place;
  }

  async update(tenantId: string, id: string, body: UpdatePlace) {
    await this.get(tenantId, id);
    await this.prisma.place.update({
      where: { id },
      data: {
        name: body.name,
        kind: body.kind,
        note: body.note === undefined ? undefined : body.note || null,
        lat: body.lat,
        lng: body.lng,
        radiusM: body.radiusM,
        rewardAmount: body.rewardAmount === undefined ? undefined : body.rewardAmount ? new Prisma.Decimal(body.rewardAmount) : null,
      },
    });
    return { ok: true };
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.place.delete({ where: { id } });
    return { ok: true };
  }
}
