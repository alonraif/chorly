import { ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { LOCATION_SHARE_MAX_FAILED_PINS, notificationText, type CreateLocationShare } from '@chorly/shared';
import { hashSessionToken, newSessionToken } from '../common/session/session-token';
import { LocationService } from '../location/location.service';
import { PrismaService } from '../prisma.service';
import { PushService } from '../push/push.service';
import { UsersService } from '../users/users.service';

const scrypt = promisify(scryptCb) as (pin: string, salt: Buffer, keylen: number) => Promise<Buffer>;

// How long one right PIN keeps the map open, at most. The page holds it in memory only.
const VIEW_TTL_MS = 12 * 60 * 60_000;
// Locked links stay listed for a day so the parents' alert leads somewhere.
const LOCKED_LISTED_MS = 24 * 60 * 60_000;
// Polling every few seconds shouldn't write to the database every time.
const VIEWED_WRITE_MS = 60_000;
const NOT_FOUND = 'Share link not found or expired';

type ActiveLink = { id: string; tenantId: string; label: string | null; userIds: string[]; expiresAt: Date; pinHash: string | null };

async function hashPin(pin: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function pinMatches(pin: string, stored: string) {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

@Injectable()
export class LocationShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly location: LocationService,
    private readonly users: UsersService,
    private readonly push: PushService,
  ) {}

  // ---- Parents ----

  async list(tenantId: string) {
    const now = new Date();
    const links = await this.prisma.locationShareLink.findMany({
      where: {
        tenantId,
        OR: [
          { revokedAt: null, expiresAt: { gt: now } },
          { revokeReason: 'pin_failed', revokedAt: { gt: new Date(now.getTime() - LOCKED_LISTED_MS) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { displayName: true } } },
    });
    return links.map((link) => ({
      id: link.id,
      label: link.label,
      userIds: link.userIds,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
      createdBy: link.createdBy.displayName,
      lastViewedAt: link.lastViewedAt,
      pinSet: !!link.pinHash,
      locked: link.revokeReason === 'pin_failed',
    }));
  }

  async create(tenantId: string, createdById: string, input: CreateLocationShare) {
    const userIds = [...new Set(input.userIds)];
    const found = await this.prisma.user.count({ where: { tenantId, isActive: true, id: { in: userIds } } });
    if (found !== userIds.length) throw new NotFoundException('Family member not found');
    const token = newSessionToken();
    const link = await this.prisma.locationShareLink.create({
      data: {
        tenantId,
        createdById,
        tokenHash: hashSessionToken(token),
        label: input.label || null,
        userIds,
        expiresAt: new Date(Date.now() + input.durationMinutes * 60_000),
      },
    });
    return { id: link.id, token, expiresAt: link.expiresAt };
  }

  async revoke(tenantId: string, id: string) {
    const { count } = await this.prisma.locationShareLink.updateMany({
      where: { id, tenantId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'parent' },
    });
    if (count === 0) throw new NotFoundException(NOT_FOUND);
    await this.prisma.locationShareView.deleteMany({ where: { linkId: id } });
    return { ok: true };
  }

  // ---- Whoever has the link ----

  private async linkFor(token: string): Promise<ActiveLink> {
    const link = await this.prisma.locationShareLink.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: { id: true, tenantId: true, label: true, userIds: true, expiresAt: true, pinHash: true, revokedAt: true, revokeReason: true },
    });
    if (!link || link.expiresAt <= new Date()) throw new NotFoundException(NOT_FOUND);
    if (link.revokedAt) {
      if (link.revokeReason === 'pin_failed') throw new GoneException('Link locked');
      throw new NotFoundException(NOT_FOUND);
    }
    return link;
  }

  async status(token: string) {
    const link = await this.linkFor(token);
    return { pinSet: !!link.pinHash, expiresAt: link.expiresAt, label: link.label };
  }

  async setPin(token: string, pin: string) {
    const link = await this.linkFor(token);
    const pinHash = await hashPin(pin);
    // Only the first person to open the link picks the PIN, even if two open it at once.
    const { count } = await this.prisma.locationShareLink.updateMany({
      where: { id: link.id, pinHash: null },
      data: { pinHash, pinSetAt: new Date() },
    });
    if (count === 0) throw new ConflictException('PIN already set');
    return this.openView(link);
  }

  async verifyPin(token: string, pin: string) {
    const link = await this.linkFor(token);
    if (!link.pinHash) throw new ConflictException('PIN not set');
    if (await pinMatches(pin, link.pinHash)) {
      await this.prisma.locationShareLink.update({ where: { id: link.id }, data: { failedPins: 0 } });
      return this.openView(link);
    }

    const { failedPins } = await this.prisma.locationShareLink.update({
      where: { id: link.id },
      data: { failedPins: { increment: 1 } },
      select: { failedPins: true },
    });
    if (failedPins < LOCATION_SHARE_MAX_FAILED_PINS) {
      throw new ForbiddenException({ message: 'Wrong PIN', attemptsLeft: LOCATION_SHARE_MAX_FAILED_PINS - failedPins });
    }
    // Only the request that actually locks the link tells the parents.
    const { count } = await this.prisma.locationShareLink.updateMany({
      where: { id: link.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'pin_failed' },
    });
    if (count > 0) {
      await this.prisma.locationShareView.deleteMany({ where: { linkId: link.id } });
      const parents = await this.prisma.user.findMany({ where: { tenantId: link.tenantId, isActive: true, isAdmin: true }, select: { id: true } });
      // A security alert: sent whatever the parents' notification settings say.
      await this.push.sendToUsers(
        parents.map((p) => p.id),
        null,
        (locale) => ({ ...notificationText.shareLinkLocked(locale, link.label), url: '/admin/users' }),
      );
    }
    throw new GoneException('Link locked');
  }

  private async openView(link: ActiveLink) {
    const viewToken = newSessionToken();
    const expiresAt = new Date(Math.min(Date.now() + VIEW_TTL_MS, link.expiresAt.getTime()));
    await this.prisma.locationShareView.create({ data: { linkId: link.id, tokenHash: hashSessionToken(viewToken), expiresAt } });
    return { viewToken };
  }

  // The link, if this view token was handed out for it and both are still good.
  private async linkForView(token: string, viewToken: string | undefined) {
    const link = await this.linkFor(token);
    if (!viewToken) throw new NotFoundException(NOT_FOUND);
    const view = await this.prisma.locationShareView.findUnique({ where: { tokenHash: hashSessionToken(viewToken) } });
    if (!view || view.linkId !== link.id || view.expiresAt <= new Date()) throw new NotFoundException(NOT_FOUND);
    return link;
  }

  // Only the chosen members, and only what the family itself would see of them: each member's own
  // sharing choices (paused, neighbourhood only, until a time) still apply. No speed, heading, trips or trail.
  async map(token: string, viewToken: string | undefined) {
    const link = await this.linkForView(token, viewToken);
    const [people, entries] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId: link.tenantId, isActive: true, id: { in: link.userIds } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, displayName: true, avatarAt: true },
      }),
      this.location.entries(link.tenantId),
    ]);
    const byId = new Map(entries.map((e) => [e.userId, e]));
    const placeIds = [...new Set(people.flatMap((p) => byId.get(p.id)?.placeId ?? []))];
    const places = placeIds.length
      ? await this.prisma.place.findMany({ where: { tenantId: link.tenantId, id: { in: placeIds } }, select: { id: true, name: true, kind: true } })
      : [];
    const placeById = new Map(places.map((p) => [p.id, p]));

    await this.prisma.locationShareLink.updateMany({
      where: { id: link.id, OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: new Date(Date.now() - VIEWED_WRITE_MS) } }] },
      data: { lastViewedAt: new Date() },
    });

    return {
      label: link.label,
      expiresAt: link.expiresAt,
      people: people.map((person) => {
        const entry = byId.get(person.id);
        const place = entry?.placeId ? placeById.get(entry.placeId) : undefined;
        return {
          id: person.id,
          displayName: person.displayName,
          avatarAt: person.avatarAt,
          location: entry
            ? {
                mode: entry.mode,
                updatedAt: entry.updatedAt,
                lat: entry.lat,
                lng: entry.lng,
                accuracy: entry.accuracy,
                blurRadiusM: entry.blurRadiusM,
                placeSince: place ? entry.placeSince : null,
              }
            : null,
          place: place ? { name: place.name, kind: place.kind } : null,
        };
      }),
    };
  }

  async avatar(token: string, viewToken: string | undefined, userId: string) {
    const link = await this.linkForView(token, viewToken);
    if (!link.userIds.includes(userId)) throw new NotFoundException('Picture not found');
    return this.users.avatar(link.tenantId, userId);
  }
}
