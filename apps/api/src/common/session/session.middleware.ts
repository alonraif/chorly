import { Injectable, NestMiddleware } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { hashSessionToken, readCookie, SESSION_COOKIE } from './session-token';
import type { RequestUser } from './session.types';

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: any, _res: any, next: () => void) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      const session = await this.prisma.session.findUnique({
        where: { tokenHash: hashSessionToken(token) },
        select: {
          expiresAt: true,
          user: {
            select: {
              id: true,
              tenantId: true,
              email: true,
              displayName: true,
              role: true,
              isAdmin: true,
              locale: true,
              isAway: true,
              isActive: true,
            },
          },
        },
      });
      if (session && session.expiresAt > new Date() && session.user.isActive) {
        req.user = session.user as RequestUser;
        req.tenantId = session.user.tenantId;
      }
    }
    next();
  }
}
