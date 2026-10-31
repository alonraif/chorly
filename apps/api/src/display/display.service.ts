import { Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { hashSessionToken, newSessionToken } from '../common/session/session-token';
import type { RequestUser } from '../common/session/session.types';
import { InstancesService } from '../instances/instances.service';
import { PrismaService } from '../prisma.service';
import { UsersService } from '../users/users.service';

const TZ = process.env.TIMEZONE || 'Asia/Jerusalem';

// Same view as a kid: parents' chores stay off the board, and so do all proofs.
const BOARD_VIEWER = { id: 'display', isAdmin: false } as RequestUser;

type ChoreState = 'todo' | 'overdue' | 'waiting' | 'approved';

@Injectable()
export class DisplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instances: InstancesService,
    private readonly users: UsersService,
  ) {}

  async status(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { displayTokenHash: true } });
    return { enabled: !!tenant?.displayTokenHash };
  }

  async create(tenantId: string) {
    const token = newSessionToken();
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { displayTokenHash: hashSessionToken(token) } });
    return { token };
  }

  async turnOff(tenantId: string) {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { displayTokenHash: null } });
    return { enabled: false };
  }

  private async tenantFor(token: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { displayTokenHash: hashSessionToken(token) },
      select: { id: true, name: true, defaultLocale: true },
    });
    if (!tenant) throw new NotFoundException('Display link not found');
    return tenant;
  }

  // Only what the board draws: no money, notes, proofs or places, since it sits in the open.
  async board(token: string) {
    const tenant = await this.tenantFor(token);
    const now = DateTime.now().setZone(TZ);
    const today = now.startOf('day');
    const [kids, instances] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId: tenant.id, role: 'child', isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, displayName: true, avatarAt: true, isAway: true },
      }),
      this.instances.list(tenant.id, BOARD_VIEWER, today.minus({ days: 7 }).toJSDate(), today.endOf('day').toJSDate()),
    ]);

    const stateOf = (instance: (typeof instances)[number], kidId: string): ChoreState => {
      const mine = instance.doneByUserId[kidId];
      if (instance.status === 'approved') return 'approved';
      if (instance.status === 'done' || (mine && !mine.undoneAt)) return 'waiting';
      return DateTime.fromISO(instance.dueAt) < now ? 'overdue' : 'todo';
    };

    return {
      family: { name: tenant.name, locale: tenant.defaultLocale },
      kids: kids.map((kid) => {
        const chores = instances
          .filter((i) => i.assignments.some((a) => a.userId === kid.id))
          .map((i) => ({
            id: i.id,
            title_en: i.chore.title_en,
            title_he: i.chore.title_he,
            dueAt: i.dueAt,
            state: stateOf(i, kid.id),
          }));
        const isToday = (chore: { dueAt: string }) => DateTime.fromISO(chore.dueAt) >= today;
        return {
          id: kid.id,
          displayName: kid.displayName,
          avatarAt: kid.avatarAt ? kid.avatarAt.toISOString() : null,
          isAway: kid.isAway,
          chores: chores.filter(isToday),
          // Only a count: a bad week shouldn't push today off the board.
          missed: chores.filter((c) => !isToday(c) && c.state === 'overdue').length,
        };
      }),
    };
  }

  async avatar(token: string, userId: string) {
    const tenant = await this.tenantFor(token);
    const kid = await this.prisma.user.findFirst({ where: { id: userId, tenantId: tenant.id, role: 'child', isActive: true }, select: { id: true } });
    if (!kid) throw new NotFoundException('Picture not found');
    return this.users.avatar(tenant.id, userId);
  }
}
