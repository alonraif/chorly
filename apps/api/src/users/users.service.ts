import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { CreateUser, UpdateUser } from '@chorly/shared';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  async get(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { tenantId, id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  create(tenantId: string, data: CreateUser) {
    return this.prisma.user.create({
      data: {
        tenantId,
        email: data.email ?? null,
        displayName: data.displayName,
        isAdmin: data.isAdmin ?? false,
        locale: data.locale ?? 'he',
        isAway: data.isAway ?? false,
      },
    });
  }

  async update(tenantId: string, id: string, data: UpdateUser) {
    await this.get(tenantId, id);
    return this.prisma.user.update({
      where: { id },
      data: {
        email: data.email,
        displayName: data.displayName,
        isAdmin: data.isAdmin,
        locale: data.locale,
        isAway: data.isAway,
      },
    });
  }
}
