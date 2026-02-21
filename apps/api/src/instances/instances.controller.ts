import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApproveInstanceSchema,
  InstanceListQuerySchema,
  MarkDoneSchema,
  UndoDoneSchema,
} from '@chorly/shared';
import { z } from 'zod';
import { AdminGuard } from '../common/dev-auth/admin.guard';
import { CurrentTenant } from '../common/dev-auth/current-tenant.decorator';
import { CurrentUser } from '../common/dev-auth/current-user.decorator';
import type { RequestUser } from '../common/dev-auth/dev-auth.types';
import { RequireTenantGuard } from '../common/dev-auth/require-tenant.guard';
import { RequireUserGuard } from '../common/dev-auth/require-user.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InstancesService } from './instances.service';

const UpdateInstanceSchema = z.object({
  dueAt: z.string().datetime().optional(),
  assigneeUserId: z.string().min(1).optional(),
}).refine((data) => data.dueAt !== undefined || data.assigneeUserId !== undefined, {
  message: 'At least one field is required',
});

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

  @Delete(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Delete one chore instance (family admin)' })
  @ApiParam({ name: 'id' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.instances.remove(tenantId, id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update one chore instance (family admin)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: { type: 'object', properties: { dueAt: { type: 'string', format: 'date-time' }, assigneeUserId: { type: 'string' } } } })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateInstanceSchema)) body: z.infer<typeof UpdateInstanceSchema>,
  ) {
    return this.instances.update(tenantId, id, body);
  }
}
