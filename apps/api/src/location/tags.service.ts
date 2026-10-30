import { Injectable, NotFoundException } from '@nestjs/common';
import type { MapTagInput, UpdateMapTag } from '@chorly/shared';
import type { RequestUser } from '../common/session/session.types';
import { PrismaService } from '../prisma.service';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.mapTag.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, emoji: true, lat: true, lng: true, updatedById: true, updatedAt: true },
    });
  }

  async create(user: RequestUser, body: MapTagInput) {
    const tag = await this.prisma.mapTag.create({ data: { tenantId: user.tenantId, updatedById: user.id, ...body } });
    return { id: tag.id };
  }

  private async get(tenantId: string, id: string) {
    const tag = await this.prisma.mapTag.findFirst({ where: { id, tenantId } });
    if (!tag) throw new NotFoundException('Tag not found');
    return tag;
  }

  async update(user: RequestUser, id: string, body: UpdateMapTag) {
    await this.get(user.tenantId, id);
    await this.prisma.mapTag.update({ where: { id }, data: { ...body, updatedById: user.id } });
    return { ok: true };
  }

  async remove(tenantId: string, id: string) {
    await this.get(tenantId, id);
    await this.prisma.mapTag.delete({ where: { id } });
    return { ok: true };
  }
}
