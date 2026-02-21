import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CreateUserSchema, UpdateUserSchema } from '@chorly/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';
import { AdminGuard } from '../common/dev-auth/admin.guard';
import { CurrentTenant } from '../common/dev-auth/current-tenant.decorator';
import { RequireTenantGuard } from '../common/dev-auth/require-tenant.guard';

@ApiTags('users')
@ApiHeader({ name: 'x-user-id', required: false })
@ApiHeader({ name: 'x-tenant-id', required: false, description: 'System admin tenant override' })
@Controller('/users')
@UseGuards(RequireTenantGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users in current family' })
  list(@CurrentTenant() tenantId: string) {
    return this.users.list(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user in current family' })
  @ApiParam({ name: 'id' })
  get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.users.get(tenantId, id);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create user (family admin)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['displayName'],
      properties: {
        email: { type: 'string', format: 'email' },
        displayName: { type: 'string' },
        isAdmin: { type: 'boolean' },
        locale: { type: 'string', enum: ['en', 'he'] },
        isAway: { type: 'boolean' },
      },
    },
  })
  create(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(CreateUserSchema)) body: any) {
    return this.users.create(tenantId, body);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update user (family admin)' })
  @ApiParam({ name: 'id' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        displayName: { type: 'string' },
        isAdmin: { type: 'boolean' },
        locale: { type: 'string', enum: ['en', 'he'] },
        isAway: { type: 'boolean' },
      },
    },
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) body: any,
  ) {
    return this.users.update(tenantId, id, body);
  }
}
