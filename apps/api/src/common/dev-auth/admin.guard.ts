import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.user) {
      throw new UnauthorizedException('x-user-id header is required');
    }
    if (!req.user.isAdmin && !req.user.isSystemAdmin) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
