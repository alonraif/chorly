import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { MoneyLedgerType, Prisma } from '@prisma/client';
import type { Readable } from 'stream';
import { PrismaService } from '../prisma.service';
import type { CreateUser, NotificationPrefs, UpdateUser } from '@chorly/shared';
import type { RequestUser } from '../common/session/session.types';
import { hashPassword } from '../common/auth/password';

// The web client always sends a small square JPEG, so anything bigger isn't from it.
const MAX_AVATAR_BYTES = 512 * 1024;
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly publicUserSelect = {
    id: true,
    tenantId: true,
    email: true,
    displayName: true,
    role: true,
    isAdmin: true,
    locale: true,
    isActive: true,
    isAway: true,
    notifyPrefs: true,
    avatarAt: true,
    createdAt: true,
  } satisfies Prisma.UserSelect;

  list(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: this.publicUserSelect,
    });
  }

  async get(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, id },
      select: this.publicUserSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(tenantId: string, data: CreateUser) {
    if (data.email && !data.password) {
      throw new BadRequestException('Password is required when email is provided');
    }
    const passwordHash = data.password ? await hashPassword(data.password) : null;
    return this.prisma.user.create({
      data: {
        tenantId,
        email: data.email ?? null,
        passwordHash,
        displayName: data.displayName,
        role: data.role,
        isAdmin: data.role === 'parent',
        locale: data.locale ?? 'he',
        isAway: data.isAway ?? false,
      },
      select: this.publicUserSelect,
    });
  }

  // Merges into the stored preferences, so a client can flip one type at a time.
  async updateNotifyPrefs(tenantId: string, id: string, prefs: NotificationPrefs) {
    const user = await this.get(tenantId, id);
    return this.prisma.user.update({
      where: { id },
      data: { notifyPrefs: { ...((user.notifyPrefs as NotificationPrefs | null) ?? {}), ...prefs } },
      select: this.publicUserSelect,
    });
  }

  async setAvatar(tenantId: string, id: string, contentType: string | undefined, body: Readable) {
    if ((contentType || '').split(';')[0].trim().toLowerCase() !== 'image/jpeg') {
      throw new BadRequestException('Only JPEG pictures can be uploaded');
    }
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of body) {
      received += chunk.length;
      if (received > MAX_AVATAR_BYTES) throw new PayloadTooLargeException('This picture is too big');
      chunks.push(chunk);
    }
    const jpeg = Buffer.concat(chunks);
    if (!jpeg.subarray(0, 3).equals(JPEG_START)) throw new BadRequestException('Only JPEG pictures can be uploaded');

    await this.get(tenantId, id);
    const [, user] = await this.prisma.$transaction([
      this.prisma.userAvatar.upsert({ where: { userId: id }, create: { userId: id, jpeg }, update: { jpeg } }),
      this.prisma.user.update({ where: { id }, data: { avatarAt: new Date() }, select: this.publicUserSelect }),
    ]);
    return user;
  }

  async removeAvatar(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const [, user] = await this.prisma.$transaction([
      this.prisma.userAvatar.deleteMany({ where: { userId: id } }),
      this.prisma.user.update({ where: { id }, data: { avatarAt: null }, select: this.publicUserSelect }),
    ]);
    return user;
  }

  async avatar(tenantId: string, id: string) {
    const avatar = await this.prisma.userAvatar.findFirst({ where: { userId: id, user: { tenantId } } });
    if (!avatar) throw new NotFoundException('Picture not found');
    return Buffer.from(avatar.jpeg);
  }

  async update(tenantId: string, id: string, data: UpdateUser) {
    await this.get(tenantId, id);
    const passwordHash = data.password !== undefined ? await hashPassword(data.password) : undefined;
    if (passwordHash) {
      await this.prisma.session.deleteMany({ where: { userId: id } });
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        email: data.email,
        passwordHash,
        displayName: data.displayName,
        role: data.role,
        isAdmin: data.role === undefined ? undefined : data.role === 'parent',
        locale: data.locale,
        isAway: data.isAway,
      },
      select: this.publicUserSelect,
    });
  }

  async earnings(tenantId: string, userId: string, actor: RequestUser) {
    if (actor.id !== userId && !actor.isAdmin) {
      throw new ForbiddenException('Cannot view earnings for this user');
    }

    await this.get(tenantId, userId);

    const [tenant, earnedAgg, payoutAgg, earnEntries, payoutEntries] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.prisma.moneyLedger.aggregate({
        where: { tenantId, userId, type: MoneyLedgerType.earn },
        _sum: { amount: true },
      }),
      this.prisma.moneyLedger.aggregate({
        where: { tenantId, userId, type: MoneyLedgerType.payout },
        _sum: { amount: true },
      }),
      this.prisma.moneyLedger.findMany({
        where: { tenantId, userId, type: MoneyLedgerType.earn },
        include: { instance: { include: { chore: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.moneyLedger.findMany({
        where: { tenantId, userId, type: MoneyLedgerType.payout },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const earnedTotal = earnedAgg._sum.amount ?? new Prisma.Decimal(0);
    const payoutTotal = payoutAgg._sum.amount ?? new Prisma.Decimal(0);
    const dueAmount = earnedTotal.minus(payoutTotal);

    return {
      userId,
      currencyCode: tenant.currencyCode,
      earnedTotal: earnedTotal.toString(),
      paidOutTotal: payoutTotal.toString(),
      dueAmount: dueAmount.toString(),
      earnEntries: earnEntries.map((entry) => ({
        id: entry.id,
        amount: entry.amount.toString(),
        createdAt: entry.createdAt.toISOString(),
        instanceId: entry.instanceId,
        choreTitleEn: entry.instance?.chore.title_en ?? null,
        choreTitleHe: entry.instance?.chore.title_he ?? null,
        dueAt: entry.instance?.dueAt ? entry.instance.dueAt.toISOString() : null,
      })),
      payoutEntries: payoutEntries.map((entry) => ({
        id: entry.id,
        amount: entry.amount.toString(),
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  async payoutReset(tenantId: string, userId: string, actor: RequestUser) {
    if (!actor.isAdmin) {
      throw new ForbiddenException('Admin required');
    }

    await this.get(tenantId, userId);

    const [earnedAgg, payoutAgg] = await Promise.all([
      this.prisma.moneyLedger.aggregate({
        where: { tenantId, userId, type: MoneyLedgerType.earn },
        _sum: { amount: true },
      }),
      this.prisma.moneyLedger.aggregate({
        where: { tenantId, userId, type: MoneyLedgerType.payout },
        _sum: { amount: true },
      }),
    ]);

    const earnedTotal = earnedAgg._sum.amount ?? new Prisma.Decimal(0);
    const payoutTotal = payoutAgg._sum.amount ?? new Prisma.Decimal(0);
    const dueAmount = earnedTotal.minus(payoutTotal);
    if (dueAmount.lte(0)) {
      return {
        ok: true,
        created: false,
        paidOutAmount: '0',
        dueAmount: '0',
      };
    }

    const payout = await this.prisma.moneyLedger.create({
      data: {
        tenantId,
        userId,
        type: MoneyLedgerType.payout,
        amount: dueAmount,
      },
    });

    return {
      ok: true,
      created: true,
      paidOutAmount: payout.amount.toString(),
      dueAmount: '0',
      payoutEntryId: payout.id,
      createdAt: payout.createdAt.toISOString(),
    };
  }
}
