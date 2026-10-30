import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApproveInstanceSchema,
  InstanceListQuerySchema,
  MarkDoneSchema,
  RejectInstanceSchema,
  UndoDoneSchema,
} from '@chorly/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AdminGuard } from '../common/session/admin.guard';
import { CurrentTenant } from '../common/session/current-tenant.decorator';
import { CurrentUser } from '../common/session/current-user.decorator';
import type { RequestUser } from '../common/session/session.types';
import { RequireTenantGuard } from '../common/session/require-tenant.guard';
import { RequireUserGuard } from '../common/session/require-user.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InstancesService } from './instances.service';

const UpdateInstanceSchema = z.object({
  dueAt: z.string().datetime().optional(),
  assigneeUserId: z.string().min(1).optional(),
}).refine((data) => data.dueAt !== undefined || data.assigneeUserId !== undefined, {
  message: 'At least one field is required',
});

@ApiTags('instances')
@Controller('/instances')
@UseGuards(RequireTenantGuard)
export class InstancesController {
  constructor(private readonly instances: InstancesService) {}

  @Get()
  @ApiOperation({ summary: 'List instances by date range' })
  @ApiQuery({ name: 'from', required: true, type: String })
  @ApiQuery({ name: 'to', required: true, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @UseGuards(RequireUserGuard)
  list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(InstanceListQuerySchema)) query: any,
  ) {
    return this.instances.list(tenantId, user, new Date(query.from), new Date(query.to), query.userId);
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

  @Post(':id/proof')
  @UseGuards(RequireUserGuard)
  @ApiOperation({ summary: 'Upload a photo or clip for mark-done (raw image/jpeg, video/mp4 or video/webm body)' })
  @ApiParam({ name: 'id' })
  uploadProof(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.instances.uploadProof(tenantId, id, user, req);
  }

  @Get(':id/proofs/:key')
  @UseGuards(RequireUserGuard)
  @ApiOperation({ summary: 'Stream a proof (family admin, or the person who took it)' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'key' })
  async proof(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('key') key: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const file = await this.instances.proofPath(tenantId, id, key, user);
    // sendFile handles Range requests, which Safari needs to play video.
    res.sendFile(file, { cacheControl: false, headers: { 'Cache-Control': 'private, max-age=3600' } });
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

  @Post(':id/reject')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Reject a done instance back to not done (family admin)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: { type: 'object', properties: { reason: { type: 'string' } } } })
  reject(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(RejectInstanceSchema)) body: any,
  ) {
    return this.instances.reject(tenantId, id, user, body);
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
