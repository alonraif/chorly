import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FamilyRole, InviteStatus, Prisma, type Locale } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import type { RequestUser } from '../common/dev-auth/dev-auth.types';
import { TEMPLATE_CHORES } from '../common/templates/template-catalog';
import { hashPassword } from '../common/auth/password';

@Injectable()
export class FamilyService {
  constructor(private readonly prisma: PrismaService) {}

  async createFamily(input: { familyName: string; displayName: string; role: FamilyRole; email?: string; password: string; locale?: Locale }) {
    const email = input.email?.trim().toLowerCase();
    if (email) {
      const exists = await this.prisma.user.findUnique({ where: { email } });
      if (exists) throw new ConflictException('Email already exists');
    }
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
          email: email ?? null,
          passwordHash,
          displayName: input.displayName,
          role: input.role,
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

  listMembers(tenantId: string) {
    return this.prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  current(tenantId: string) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, defaultLocale: true },
    });
  }

  async invite(tenantId: string, inviter: RequestUser, email: string, role: FamilyRole, expiresInDays = 7) {
    if (!inviter.isAdmin && !inviter.isSystemAdmin) throw new BadRequestException('Admin required');
    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.familyInvite.create({
      data: {
        tenantId,
        inviterUserId: inviter.id,
        email: email.trim().toLowerCase(),
        role,
        token,
        expiresAt,
      },
    });

    return invite;
  }

  listInvites(tenantId: string) {
    return this.prisma.familyInvite.findMany({
      where: { tenantId, status: InviteStatus.pending },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acceptInvite(input: { token: string; displayName: string; password: string; locale?: Locale; email?: string }) {
    const invite = await this.prisma.familyInvite.findUnique({ where: { token: input.token } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status !== InviteStatus.pending) throw new BadRequestException('Invite is not active');
    if (invite.expiresAt < new Date()) {
      await this.prisma.familyInvite.update({ where: { id: invite.id }, data: { status: InviteStatus.expired } });
      throw new BadRequestException('Invite expired');
    }

    const email = (input.email || invite.email).trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already exists');
    const passwordHash = await hashPassword(input.password);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: invite.tenantId,
          email,
          passwordHash,
          displayName: input.displayName,
          role: invite.role,
          locale: input.locale || 'he',
          isAdmin: false,
        },
      });

      await tx.familyInvite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.accepted, acceptedAt: new Date() },
      });

      return user;
    });
  }
}
