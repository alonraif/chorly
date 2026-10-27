import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type Locale } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { TEMPLATE_CHORES } from '../common/templates/template-catalog';
import { hashPassword } from '../common/auth/password';

@Injectable()
export class FamilyService {
  constructor(private readonly prisma: PrismaService) {}

  async createFamily(input: { familyName: string; displayName: string; email: string; password: string; locale?: Locale }) {
    const email = input.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Email already exists');
    const passwordHash = await hashPassword(input.password);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id: `tenant-${randomBytes(6).toString('hex')}`,
          name: input.familyName,
          defaultLocale: input.locale || 'he',
        },
      });

      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          displayName: input.displayName,
          role: 'parent',
          locale: input.locale || 'he',
          isAdmin: true,
        },
      });

      for (const template of TEMPLATE_CHORES) {
        await tx.choreDefinition.create({
          data: {
            id: `template-${template.title_en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tenant.id}`,
            tenantId: tenant.id,
            title_en: template.title_en,
            title_he: template.title_he,
            hasReward: false,
            rewardAmount: null,
            allowNotes: true,
            allowPhotoProof: false,
            scheduleJson: template.scheduleJson as Prisma.InputJsonValue,
            assignmentJson: {
              mode: 'fixed',
              shared: false,
              skipAwayUsers: true,
              assigneeIds: [admin.id],
            },
            isTemplate: true,
          },
        });
      }

      return { tenant, admin };
    });
  }

  current(tenantId: string) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, defaultLocale: true },
    });
  }
}
