import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApproveInstanceSchema,
  InstanceListQuerySchema,
  MarkDoneSchema,
  UndoDoneSchema,
} from '@chorly/shared';
import { AdminGuard } from '../common/dev-auth/admin.guard';
import { CurrentTenant } from '../common/dev-auth/current-tenant.decorator';
import { CurrentUser } from '../common/dev-auth/current-user.decorator';
import type { RequestUser } from '../common/dev-auth/dev-auth.types';
import { RequireTenantGuard } from '../common/dev-auth/require-tenant.guard';
import { RequireUserGuard } from '../common/dev-auth/require-user.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InstancesService } from './instances.service';

@ApiTags('instances')
@ApiHeader({ name: 'x-user-id', required: false })
@ApiHeader({ name: 'x-tenant-id', required: false, description: 'System admin tenant override' })
@Controller('/instances')
@UseGuards(RequireTenantGuard)
export class InstancesController {
  constructor(private readonly instances: InstancesService) {}

  @Get()
  @ApiOperation({ summary: 'List instances by date range' })
  @ApiQuery({ name: 'from', required: true, type: String })
  @ApiQuery({ name: 'to', required: true, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String })
  list(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(InstanceListQuerySchema)) query: any) {
    return this.instances.list(tenantId, new Date(query.from), new Date(query.to), query.userId);
  }

  @Post(':id/mark-done')
  @UseGuards(RequireUserGuard)
  @ApiOperation({ summary: 'Mark instance as done for current user' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: { type: 'object', properties: { note: { type: 'string' }, photoKeys: { type: 'array', items: { type: 'string' } } } } })
  markDone(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(MarkDoneSchema)) body: any,
  ) {
    return this.instances.markDone(tenantId, id, user, body);
  }

  @Post(':id/undo')
  @UseGuards(RequireUserGuard)
  @ApiOperation({ summary: 'Undo done status for current user' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: { type: 'object', properties: {} } })
  undo(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(UndoDoneSchema)) _body: any,
  ) {
    return this.instances.undo(tenantId, id, user);
  }

  @Post(':id/approve')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Approve an instance (family admin)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: { type: 'object', properties: { rewardAmount: { type: 'string', example: '10.00' } } } })
  approve(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(ApproveInstanceSchema)) body: any,
  ) {
    return this.instances.approve(tenantId, id, user, body);
  }
}
