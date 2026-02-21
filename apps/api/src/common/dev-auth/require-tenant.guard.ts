import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class RequireTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.tenantId) {
      throw new UnauthorizedException('Tenant context missing. Provide x-user-id or x-tenant-id for system admin');
    }
    return true;
  }
}
