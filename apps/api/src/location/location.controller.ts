import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocationReportSchema } from '@chorly/shared';
import { CurrentTenant } from '../common/session/current-tenant.decorator';
import { CurrentUser } from '../common/session/current-user.decorator';
import { RequireUserGuard } from '../common/session/require-user.guard';
import type { RequestUser } from '../common/session/session.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LocationService } from './location.service';

@ApiTags('location')
@Controller('/location')
@UseGuards(RequireUserGuard)
export class LocationController {
  constructor(private readonly location: LocationService) {}

  @Get()
  @ApiOperation({ summary: 'Last known location of everyone in the family who shares it' })
  list(@CurrentTenant() tenantId: string) {
    return this.location.list(tenantId);
  }

  @Post('/me')
  @ApiOperation({ summary: 'Report my current location' })
  async report(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(LocationReportSchema)) body: any) {
    await this.location.report(user.id, body);
    return { ok: true };
  }

  @Delete('/me')
  @ApiOperation({ summary: 'Stop sharing and forget my location' })
  async stop(@CurrentUser() user: RequestUser) {
    await this.location.stop(user.id);
    return { ok: true };
  }
}
