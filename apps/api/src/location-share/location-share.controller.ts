import { Body, Controller, Delete, Get, Header, Headers, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CreateLocationShareSchema, SharePinSchema } from '@chorly/shared';
import { AdminGuard } from '../common/session/admin.guard';
import { CurrentTenant } from '../common/session/current-tenant.decorator';
import { CurrentUser } from '../common/session/current-user.decorator';
import type { RequestUser } from '../common/session/session.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LocationShareService } from './location-share.service';

const VIEW_HEADER = 'x-share-view';

@ApiTags('location-share')
@Controller()
export class LocationShareController {
  constructor(private readonly shares: LocationShareService) {}

  @Get('/family/location-shares')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Location share links that still work, and ones locked in the last day (family admin)' })
  list(@CurrentTenant() tenantId: string) {
    return this.shares.list(tenantId);
  }

  @Post('/family/location-shares')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create a temporary location share link (family admin). The token is returned only here.' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(CreateLocationShareSchema)) body: any) {
    return this.shares.create(tenantId, user.id, body);
  }

  @Delete('/family/location-shares/:id')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Turn a location share link off (family admin)' })
  @ApiParam({ name: 'id' })
  revoke(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.shares.revoke(tenantId, id);
  }

  // No session below: the link's token and then a PIN stand in for one.
  @Get('/share/location/:token/status')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Whether the link still works and has a PIN yet' })
  @ApiParam({ name: 'token' })
  status(@Param('token') token: string) {
    return this.shares.status(token);
  }

  @Post('/share/location/:token/pin/set')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Pick the PIN, the first time the link is opened' })
  @ApiParam({ name: 'token' })
  setPin(@Param('token') token: string, @Body(new ZodValidationPipe(SharePinSchema)) body: { pin: string }) {
    return this.shares.setPin(token, body.pin);
  }

  @Post('/share/location/:token/pin/verify')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Enter the PIN. Too many wrong ones turn the link off.' })
  @ApiParam({ name: 'token' })
  verifyPin(@Param('token') token: string, @Body(new ZodValidationPipe(SharePinSchema)) body: { pin: string }) {
    return this.shares.verifyPin(token, body.pin);
  }

  @Get('/share/location/:token')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Where the chosen members are, read-only. Needs the X-Share-View header from the PIN step.' })
  @ApiParam({ name: 'token' })
  map(@Param('token') token: string, @Headers(VIEW_HEADER) viewToken: string | undefined) {
    return this.shares.map(token, viewToken);
  }

  @Get('/share/location/:token/avatars/:userId')
  @ApiOperation({ summary: "A chosen member's picture. Needs the X-Share-View header." })
  @ApiParam({ name: 'token' })
  @ApiParam({ name: 'userId' })
  async avatar(@Param('token') token: string, @Param('userId') userId: string, @Headers(VIEW_HEADER) viewToken: string | undefined, @Res() res: Response) {
    const jpeg = await this.shares.avatar(token, viewToken, userId);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(jpeg);
  }
}
