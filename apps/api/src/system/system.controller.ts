import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma.service';
import { SystemAdminGuard } from '../common/dev-auth/system-admin.guard';

@ApiTags('system')
@ApiHeader({ name: 'x-user-id', required: true })
@Controller('/system')
@UseGuards(SystemAdminGuard)
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/tenants')
  @ApiOperation({ summary: 'List all families/tenants (system admin)' })
  tenants() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Get('/users')
  @ApiOperation({ summary: 'List users across families (system admin)' })
  @ApiQuery({ name: 'tenantId', required: false })
  users(@Query('tenantId') tenantId?: string) {
    return this.prisma.user.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }
}
