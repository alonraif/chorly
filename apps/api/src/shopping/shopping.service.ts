import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ShoppingItem } from '@prisma/client';
import {
  SHOPPING_BOUGHT_MS,
  SHOPPING_TRIP_MS,
  guessShoppingCategory,
  notificationText,
  shoppingKey,
  type ShoppingAdd,
  type ShoppingUpdate,
} from '@chorly/shared';
import type { RequestUser } from '../common/session/session.types';
import { PrismaService } from '../prisma.service';
import { PushService } from '../push/push.service';

const SHOPPING_URL = '/shopping';
const BUY_AGAIN_LIMIT = 12;

function view(item: ShoppingItem) {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    note: item.note,
    category: item.category,
    state: item.state,
    urgent: item.urgent,
    addedById: item.addedById,
    addedAt: item.addedAt,
    boughtById: item.boughtById,
    boughtAt: item.boughtAt,
  };
}

@Injectable()
export class ShoppingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async list(tenantId: string) {
    const [rows, shoppers] = await Promise.all([
      this.prisma.shoppingItem.findMany({ where: { tenantId } }),
      this.prisma.user.findMany({
        where: { tenantId, isActive: true, shoppingSince: { gte: new Date(Date.now() - SHOPPING_TRIP_MS) } },
        select: { id: true },
      }),
    ]);
    const boughtSince = Date.now() - SHOPPING_BOUGHT_MS;
    const shown = (row: ShoppingItem) => row.state === 'needed' || (row.state === 'bought' && !!row.boughtAt && row.boughtAt.getTime() >= boughtSince);
    return {
      items: rows.filter(shown).map(view),
      known: rows.map((row) => ({ name: row.name, category: row.category })),
      buyAgain: rows
        .filter((row) => !shown(row) && row.timesBought > 0)
        .sort((a, b) => b.timesBought - a.timesBought || (b.boughtAt?.getTime() ?? 0) - (a.boughtAt?.getTime() ?? 0))
        .slice(0, BUY_AGAIN_LIMIT)
        .map((row) => row.name),
      shopperIds: shoppers.map((s) => s.id),
    };
  }

  // Two people adding the same thing at once end up with the one row, whoever got there first.
  async add(user: RequestUser, body: ShoppingAdd) {
    const nameKey = shoppingKey(body.name);
    if (!nameKey) throw new BadRequestException('Name is empty');
    const where = { tenantId_nameKey: { tenantId: user.tenantId, nameKey } };
    const existing = await this.prisma.shoppingItem.findUnique({ where });
    if (!existing) {
      try {
        const item = await this.prisma.shoppingItem.create({
          data: { tenantId: user.tenantId, name: body.name, nameKey, category: guessShoppingCategory(body.name), addedById: user.id },
        });
        return { item: view(item), already: false };
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    } else {
      // Last time's amount is not this time's, but the note ("the green one") and the aisle still hold.
      const { count } = await this.prisma.shoppingItem.updateMany({
        where: { id: existing.id, state: { not: 'needed' } },
        data: { state: 'needed', name: body.name, quantity: null, urgent: false, addedById: user.id, addedAt: new Date(), boughtById: null, boughtAt: null },
      });
      if (count > 0) return { item: view(await this.prisma.shoppingItem.findUniqueOrThrow({ where })), already: false };
    }
    return { item: view(await this.prisma.shoppingItem.findUniqueOrThrow({ where })), already: true };
  }

  private async find(tenantId: string, id: string) {
    const item = await this.prisma.shoppingItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async update(user: RequestUser, id: string, body: ShoppingUpdate) {
    const item = await this.find(user.tenantId, id);
    const data: Prisma.ShoppingItemUncheckedUpdateInput = { ...body };
    if (body.name) {
      data.nameKey = shoppingKey(body.name);
      if (!data.nameKey) throw new BadRequestException('Name is empty');
      await this.takeOverName(item, data.nameKey as string);
    }
    const updated = await this.prisma.shoppingItem.update({ where: { id }, data });
    if (body.urgent && !item.urgent && updated.state === 'needed') void this.tellFamily(user, (locale) => notificationText.shoppingUrgent(locale, user.displayName, updated.name));
    return view(updated);
  }

  // Renaming onto a past item absorbs its history, but two items on the list stay apart until someone removes one.
  private async takeOverName(item: ShoppingItem, nameKey: string) {
    if (nameKey === item.nameKey) return;
    const other = await this.prisma.shoppingItem.findUnique({ where: { tenantId_nameKey: { tenantId: item.tenantId, nameKey } } });
    if (!other) return;
    if (other.state === 'needed') throw new ConflictException('shopping_name_taken');
    await this.prisma.shoppingItem.delete({ where: { id: other.id } });
    await this.prisma.shoppingItem.update({ where: { id: item.id }, data: { timesBought: { increment: other.timesBought } } });
  }

  // Safe to send twice: a phone with bad signal retries, and the count mustn't climb.
  async buy(user: RequestUser, id: string) {
    await this.find(user.tenantId, id);
    await this.prisma.shoppingItem.updateMany({
      where: { id, state: 'needed' },
      data: { state: 'bought', boughtById: user.id, boughtAt: new Date(), timesBought: { increment: 1 } },
    });
    return { ok: true };
  }

  async unbuy(user: RequestUser, id: string) {
    await this.find(user.tenantId, id);
    await this.prisma.shoppingItem.updateMany({
      where: { id, state: 'bought' },
      data: { state: 'needed', boughtById: null, boughtAt: null, timesBought: { decrement: 1 } },
    });
    return { ok: true };
  }

  // A row stays only as a memory of something bought, so off the list a second removal forgets it,
  // and so does the first for a name that was never bought, like a typo.
  async remove(user: RequestUser, id: string) {
    const item = await this.find(user.tenantId, id);
    if (item.state === 'needed' && item.timesBought > 0) {
      await this.prisma.shoppingItem.update({ where: { id }, data: { state: 'removed', urgent: false } });
    } else {
      await this.prisma.shoppingItem.delete({ where: { id } });
    }
    return { ok: true };
  }

  private async tellFamily(user: RequestUser, text: (locale: 'en' | 'he') => { title: string; body: string }) {
    const members = await this.prisma.user.findMany({ where: { tenantId: user.tenantId, isActive: true, id: { not: user.id } }, select: { id: true } });
    await this.push.sendToUsers(members.map((m) => m.id), 'shopping', (locale) => ({ ...text(locale), url: SHOPPING_URL }));
  }

  // Tapping again while already out doesn't tell the family twice.
  async startTrip(user: RequestUser) {
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ shoppingSince: null }, { shoppingSince: { lt: new Date(Date.now() - SHOPPING_TRIP_MS) } }] },
      data: { shoppingSince: new Date() },
    });
    if (count > 0) void this.tellFamily(user, (locale) => notificationText.shoppingTrip(locale, user.displayName));
    return { ok: true };
  }

  async endTrip(user: RequestUser) {
    await this.prisma.user.update({ where: { id: user.id }, data: { shoppingSince: null } });
    return { ok: true };
  }
}
