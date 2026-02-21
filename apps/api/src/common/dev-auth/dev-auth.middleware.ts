import { Injectable, NestMiddleware } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import type { RequestUser } from './dev-auth.types';

@Injectable()
export class DevAuthMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: any, _res: any, next: () => void) {
    const userId = req.header('x-user-id');
    const tenantFromHeader = req.header('x-tenant-id');

    if (typeof userId === 'string' && userId.trim().length > 0) {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, isActive: true },
        select: {
          id: true,
          tenantId: true,
          email: true,
          displayName: true,
          isAdmin: true,
          isSystemAdmin: true,
          locale: true,
          isAway: true,
          isActive: true,
        },
      });
      if (user) {
        req.user = user as RequestUser;
        req.tenantId = user.tenantId;
      }
    }

    if (req.user?.isSystemAdmin && typeof tenantFromHeader === 'string' && tenantFromHeader.trim().length > 0) {
      req.tenantId = tenantFromHeader;
    }

    next();
  }
}
