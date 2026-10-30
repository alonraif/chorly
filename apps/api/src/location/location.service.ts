import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type LocationReport = { lat: number; lng: number; accuracy?: number };

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.userLocation.findMany({
      where: { user: { tenantId, isActive: true } },
      select: { userId: true, lat: true, lng: true, accuracy: true, updatedAt: true },
    });
  }

  async report(userId: string, report: LocationReport) {
    await this.prisma.userLocation.upsert({
      where: { userId },
      update: report,
      create: { userId, ...report },
    });
  }

  async stop(userId: string) {
    await this.prisma.userLocation.deleteMany({ where: { userId } });
  }
}
