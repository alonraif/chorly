import { Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import SunCalc from 'suncalc';
import { hashSessionToken, newSessionToken } from '../common/session/session-token';
import type { RequestUser } from '../common/session/session.types';
import { InstancesService } from '../instances/instances.service';
import { PrismaService } from '../prisma.service';
import { UsersService } from '../users/users.service';

const TZ = process.env.TIMEZONE || 'Asia/Jerusalem';

// The board shows the whole family's chores, parents' included. Only the fields picked in board() leave here.
const BOARD_VIEWER = { id: 'display', isAdmin: true } as RequestUser;
// Jerusalem, for families who haven't marked a Home place.
const DEFAULT_COORDS = { lat: 31.77, lng: 35.21 };

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
    const [people, instances, home] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId: tenant.id, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, displayName: true, avatarAt: true, role: true },
      }),
      this.instances.list(tenant.id, BOARD_VIEWER, today.minus({ days: 7 }).toJSDate(), today.endOf('day').toJSDate()),
      this.prisma.place.findFirst({ where: { tenantId: tenant.id, kind: 'home' }, orderBy: { createdAt: 'asc' }, select: { lat: true, lng: true } }),
    ]);
    const { lat, lng } = home ?? DEFAULT_COORDS;
    const sun = SunCalc.getTimes(today.plus({ hours: 12 }).toJSDate(), lat, lng);

    const stateOf = (instance: (typeof instances)[number], userId: string): ChoreState => {
      const mine = instance.doneByUserId[userId];
      if (instance.status === 'approved') return 'approved';
      if (instance.status === 'done' || (mine && !mine.undoneAt)) return 'waiting';
      return DateTime.fromISO(instance.dueAt) < now ? 'overdue' : 'todo';
    };

    return {
      family: { name: tenant.name, locale: tenant.defaultLocale },
      sun: { rise: sun.sunrise.toISOString(), set: sun.sunset.toISOString() },
      people: [...people.filter((p) => p.role === 'child'), ...people.filter((p) => p.role !== 'child')]
        .map((person) => {
          const chores = instances
            .filter((i) => i.assignments.some((a) => a.userId === person.id))
            .map((i) => ({
              id: i.id,
              title_en: i.chore.title_en,
              title_he: i.chore.title_he,
              dueAt: i.dueAt,
              state: stateOf(i, person.id),
            }));
          const isToday = (chore: { dueAt: string }) => DateTime.fromISO(chore.dueAt) >= today;
          return {
            id: person.id,
            displayName: person.displayName,
            avatarAt: person.avatarAt ? person.avatarAt.toISOString() : null,
            chores: chores.filter(isToday),
            // Only a count: a bad week shouldn't push today off the board.
            missed: chores.filter((c) => !isToday(c) && c.state === 'overdue').length,
          };
        })
        .filter((person) => person.chores.length > 0),
    };
  }

  async avatar(token: string, userId: string) {
    const tenant = await this.tenantFor(token);
    return this.users.avatar(tenant.id, userId);
  }
}
