import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CreateUserSchema, LocaleSchema, NOTIFICATION_PREFS, NotificationPrefsSchema, UpdateUserSchema } from '@chorly/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';
import { AdminGuard } from '../common/session/admin.guard';
import { CurrentUser } from '../common/session/current-user.decorator';
import type { RequestUser } from '../common/session/session.types';
import { CurrentTenant } from '../common/session/current-tenant.decorator';
import { RequireTenantGuard } from '../common/session/require-tenant.guard';
import { RequireUserGuard } from '../common/session/require-user.guard';

const UpdateMeSchema = z
  .object({ locale: LocaleSchema.optional(), notifyPrefs: NotificationPrefsSchema.optional() })
  .refine((b) => b.locale !== undefined || b.notifyPrefs !== undefined, 'Nothing to update');

@ApiTags('users')
@Controller('/users')
@UseGuards(RequireTenantGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users in current family' })
  list(@CurrentTenant() tenantId: string) {
    return this.users.list(tenantId);
  }

  // Declared before ':id' routes so "me" is not read as an id.
  @Patch('me')
  @UseGuards(RequireUserGuard)
  @ApiOperation({ summary: 'Update my own preferences (any family member)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        locale: { type: 'string', enum: ['en', 'he'] },
        notifyPrefs: { type: 'object', properties: Object.fromEntries(NOTIFICATION_PREFS.map((k) => [k, { type: 'boolean' }])) },
      },
    },
  })
  async updateMe(@CurrentTenant() tenantId: string, @CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(UpdateMeSchema)) body: any) {
    if (body.notifyPrefs) await this.users.updateNotifyPrefs(tenantId, user.id, body.notifyPrefs);
    if (body.locale) return this.users.update(tenantId, user.id, { locale: body.locale });
    return this.users.get(tenantId, user.id);
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
      required: ['displayName', 'role'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 8 },
        displayName: { type: 'string' },
        role: { type: 'string', enum: ['parent', 'child'] },
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
        password: { type: 'string', minLength: 8 },
        displayName: { type: 'string' },
        role: { type: 'string', enum: ['parent', 'child'] },
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

  @Get(':id/earnings')
  @UseGuards(RequireUserGuard)
  @ApiOperation({ summary: 'Get earnings summary and earning entries for a user' })
  @ApiParam({ name: 'id' })
  earnings(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.users.earnings(tenantId, id, user);
  }

  @Post(':id/payout-reset')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Mark current due amount as paid out (family admin)' })
  @ApiParam({ name: 'id' })
  payoutReset(@CurrentTenant() tenantId: string, @Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.users.payoutReset(tenantId, id, user);
  }
}
