import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MoneyLedgerType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { CreateUser, UpdateUser } from '@chorly/shared';
import type { RequestUser } from '../common/dev-auth/dev-auth.types';

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

  async earnings(tenantId: string, userId: string, actor: RequestUser) {
    if (actor.id !== userId && !actor.isAdmin && !actor.isSystemAdmin) {
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
    if (!actor.isAdmin && !actor.isSystemAdmin) {
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
