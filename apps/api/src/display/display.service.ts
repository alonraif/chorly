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
// More than fit on the board's one line anyway.
const MAX_URGENT = 6;

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
  // Of the shopping list, that's how long it is and what can't wait.
  async board(token: string) {
    const tenant = await this.tenantFor(token);
    const now = DateTime.now().setZone(TZ);
    const today = now.startOf('day');
    const [people, instances, home, shoppingCount, urgent] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId: tenant.id, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, displayName: true, avatarAt: true, role: true },
      }),
      this.instances.list(tenant.id, BOARD_VIEWER, today.minus({ days: 7 }).toJSDate(), today.endOf('day').toJSDate()),
      this.prisma.place.findFirst({ where: { tenantId: tenant.id, kind: 'home' }, orderBy: { createdAt: 'asc' }, select: { lat: true, lng: true } }),
      this.prisma.shoppingItem.count({ where: { tenantId: tenant.id, state: 'needed' } }),
      this.prisma.shoppingItem.findMany({
        where: { tenantId: tenant.id, state: 'needed', urgent: true },
        orderBy: { addedAt: 'desc' },
        take: MAX_URGENT,
        select: { name: true },
      }),
    ]);
    const { lat, lng } = home ?? DEFAULT_COORDS;
    const sun = SunCalc.getTimes(today.plus({ hours: 12 }).toJSDate(), lat, lng);

    const stateOf = (instance: (typeof instances)[number]): ChoreState => {
      if (instance.status === 'approved') return 'approved';
      if (instance.status === 'done' || Object.values(instance.doneByUserId).some((d) => !d.undoneAt)) return 'waiting';
      return DateTime.fromISO(instance.dueAt) < now ? 'overdue' : 'todo';
    };
    const isToday = (dueAt: string) => DateTime.fromISO(dueAt) >= today;

    // One column per set of people, so a chore they share shows once, under all of them.
    const everyone = [...people.filter((p) => p.role === 'child'), ...people.filter((p) => p.role !== 'child')];
    const groups = new Map<string, { seats: number[]; instances: typeof instances }>();
    for (const instance of instances) {
      const seats = everyone.flatMap((p, seat) => (instance.assignments.some((a) => a.userId === p.id) ? [seat] : []));
      if (seats.length === 0) continue;
      const key = seats.join('+');
      const group = groups.get(key) ?? { seats, instances: [] };
      group.instances.push(instance);
      groups.set(key, group);
    }

    return {
      family: { name: tenant.name, locale: tenant.defaultLocale },
      sun: { rise: sun.sunrise.toISOString(), set: sun.sunset.toISOString() },
      shopping: { count: shoppingCount, urgent: urgent.map((item) => item.name) },
      columns: [...groups.values()]
        // A shared column sits right after its first person's own.
        .sort((a, b) => a.seats[0] - b.seats[0] || a.seats.length - b.seats.length || a.seats[1] - b.seats[1])
        .map(({ seats, instances: group }) => {
          const chores = group.map((i) => ({
            id: i.id,
            title_en: i.chore.title_en,
            title_he: i.chore.title_he,
            dueAt: i.dueAt,
            state: stateOf(i),
          }));
          const members = seats.map((seat) => everyone[seat]);
          return {
            id: members.map((m) => m.id).join('+'),
            members: members.map((m) => ({
              id: m.id,
              displayName: m.displayName,
              avatarAt: m.avatarAt ? m.avatarAt.toISOString() : null,
            })),
            chores: chores.filter((c) => isToday(c.dueAt)),
            // Only a count: a bad week shouldn't push today off the board.
            missed: chores.filter((c) => !isToday(c.dueAt) && c.state === 'overdue').length,
          };
        })
        .filter((column) => column.chores.length > 0),
    };
  }

  async avatar(token: string, userId: string) {
    const tenant = await this.tenantFor(token);
    return this.users.avatar(tenant.id, userId);
  }
}
