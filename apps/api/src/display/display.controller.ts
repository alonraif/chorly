import { Controller, Delete, Get, Header, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminGuard } from '../common/session/admin.guard';
import { CurrentTenant } from '../common/session/current-tenant.decorator';
import { DisplayService } from './display.service';

@ApiTags('display')
@Controller()
export class DisplayController {
  constructor(private readonly display: DisplayService) {}

  @Get('/family/display')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Is the display link on? (family admin)' })
  status(@CurrentTenant() tenantId: string) {
    return this.display.status(tenantId);
  }

  @Post('/family/display')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Create the display link, replacing any existing one (family admin). The token is returned only here.' })
  create(@CurrentTenant() tenantId: string) {
    return this.display.create(tenantId);
  }

  @Delete('/family/display')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Turn the display link off (family admin)' })
  turnOff(@CurrentTenant() tenantId: string) {
    return this.display.turnOff(tenantId);
  }

  // The token stands in for a session here: a Nest Hub can't sign in.
  @Get('/display/:token')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: "Today's chores for everyone who has some, read-only" })
  @ApiParam({ name: 'token' })
  board(@Param('token') token: string) {
    return this.display.board(token);
  }

  @Get('/display/:token/avatars/:userId')
  @ApiOperation({ summary: "A family member's picture for the display" })
  @ApiParam({ name: 'token' })
  @ApiParam({ name: 'userId' })
  async avatar(@Param('token') token: string, @Param('userId') userId: string, @Res() res: Response) {
    const jpeg = await this.display.avatar(token, userId);
    // Clients add the picture's timestamp to the URL, so a new picture is a new URL.
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.send(jpeg);
  }
}
