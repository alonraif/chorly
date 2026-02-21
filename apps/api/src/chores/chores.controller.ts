import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  CreateChoreDefinitionSchema,
  UpdateChoreDefinitionSchema,
} from '@chorly/shared';
import { AdminGuard } from '../common/dev-auth/admin.guard';
import { CurrentTenant } from '../common/dev-auth/current-tenant.decorator';
import { RequireTenantGuard } from '../common/dev-auth/require-tenant.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ChoresService } from './chores.service';

const ChoreDefinitionBodySchema: any = {
  type: 'object',
  required: ['title_en', 'title_he', 'schedule', 'assignment'],
  properties: {
    title_en: { type: 'string' },
    title_he: { type: 'string' },
    hasReward: { type: 'boolean' },
    rewardAmount: { type: 'string', example: '12.50' },
    allowNotes: { type: 'boolean' },
    allowPhotoProof: { type: 'boolean' },
    schedule: {
      oneOf: [
        { type: 'object', required: ['type', 'oneTimeDueAt'], properties: { type: { type: 'string', enum: ['one_time'] }, oneTimeDueAt: { type: 'string', format: 'date-time' }, gracePeriodMinutes: { type: 'number' } } },
        { type: 'object', required: ['type', 'rrule'], properties: { type: { type: 'string', enum: ['repeating_calendar'] }, rrule: { type: 'string', example: 'FREQ=WEEKLY;BYDAY=SU,WE' }, dueTime: { type: 'string', example: '20:00' }, endsAt: { type: 'string', format: 'date-time' }, gracePeriodMinutes: { type: 'number' } } },
        { type: 'object', required: ['type', 'intervalDays'], properties: { type: { type: 'string', enum: ['repeating_after_completion'] }, intervalDays: { type: 'number' }, dueTime: { type: 'string', example: '20:00' }, endsAt: { type: 'string', format: 'date-time' }, gracePeriodMinutes: { type: 'number' } } },
      ],
    },
    assignment: {
      type: 'object',
      required: ['mode', 'shared', 'skipAwayUsers', 'assigneeIds'],
      properties: {
        mode: { type: 'string', enum: ['fixed', 'round_robin'] },
        shared: { type: 'boolean' },
        skipAwayUsers: { type: 'boolean' },
        assigneeIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

@ApiTags('chores')
@ApiHeader({ name: 'x-user-id', required: false })
@ApiHeader({ name: 'x-tenant-id', required: false, description: 'System admin tenant override' })
@Controller()
@UseGuards(RequireTenantGuard)
export class ChoresController {
  constructor(private readonly chores: ChoresService) {}

  @Get('/chores')
  @ApiOperation({ summary: 'List chore definitions' })
  list(@CurrentTenant() tenantId: string) {
    return this.chores.list(tenantId);
  }

  @Get('/chores/:id')
  @ApiOperation({ summary: 'Get chore definition' })
  @ApiParam({ name: 'id' })
  get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.chores.get(tenantId, id);
  }

  @Post('/chores')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create chore definition (family admin)' })
  @ApiBody({ schema: ChoreDefinitionBodySchema })
  create(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(CreateChoreDefinitionSchema)) body: any,
  ) {
    return this.chores.create(tenantId, body, false);
  }

  @Patch('/chores/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Update chore definition (family admin)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: { ...ChoreDefinitionBodySchema, required: [] } as any })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChoreDefinitionSchema)) body: any,
  ) {
    return this.chores.update(tenantId, id, body);
  }

  @Delete('/chores/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Soft delete chore definition (family admin)' })
  @ApiParam({ name: 'id' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.chores.remove(tenantId, id);
  }

  @Get('/templates')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'List template chores (family admin)' })
  templates(@CurrentTenant() tenantId: string) {
    return this.chores.templates(tenantId);
  }

  @Post('/templates')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create template chore (family admin)' })
  @ApiBody({ schema: ChoreDefinitionBodySchema })
  createTemplate(
    @CurrentTenant() tenantId: string,
    @Body(new ZodValidationPipe(CreateChoreDefinitionSchema)) body: any,
  ) {
    return this.chores.create(tenantId, body, true);
  }

  @Post('/templates/:id/clone')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Clone a template into active chores (family admin)' })
  @ApiParam({ name: 'id' })
  clone(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.chores.cloneTemplate(tenantId, id);
  }
}
