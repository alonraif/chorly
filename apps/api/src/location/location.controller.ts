import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ErrandInputSchema,
  LocationReportSchema,
  LocationSettingsSchema,
  MapTagInputSchema,
  PlaceInputSchema,
  PokeSchema,
  TripSchema,
  UpdateMapTagSchema,
  UpdatePlaceSchema,
} from '@chorly/shared';
import { AdminGuard } from '../common/session/admin.guard';
import { CurrentTenant } from '../common/session/current-tenant.decorator';
import { CurrentUser } from '../common/session/current-user.decorator';
import { RequireUserGuard } from '../common/session/require-user.guard';
import type { RequestUser } from '../common/session/session.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ErrandsService } from './errands.service';
import { LocationService } from './location.service';
import { PlacesService } from './places.service';
import { TagsService } from './tags.service';

@ApiTags('location')
@Controller('/location')
@UseGuards(RequireUserGuard)
export class LocationController {
  constructor(
    private readonly location: LocationService,
    private readonly places: PlacesService,
    private readonly errands: ErrandsService,
    private readonly tags: TagsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Last known location of everyone in the family who shares it' })
  list(@CurrentTenant() tenantId: string) {
    return this.location.list(tenantId);
  }

  @Get('/overview')
  @ApiOperation({ summary: 'Everything the family map shows: people, places, errands, tags and my own sharing settings' })
  async overview(@CurrentTenant() tenantId: string, @CurrentUser() user: RequestUser) {
    const [locations, places, errands, tags, mine] = await Promise.all([
      this.location.entries(tenantId),
      this.places.list(tenantId),
      this.errands.list(tenantId),
      this.tags.list(tenantId),
      this.location.mine(user.id),
    ]);
    return { locations, places, errands, tags, mine };
  }

  @Post('/me')
  @ApiOperation({ summary: 'Report my current location' })
  report(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(LocationReportSchema)) body: any) {
    return this.location.report(user, body);
  }

  @Delete('/me')
  @ApiOperation({ summary: 'Stop sharing and forget my location' })
  async stop(@CurrentUser() user: RequestUser) {
    await this.location.stop(user.id);
    return { ok: true };
  }

  @Put('/me/settings')
  @ApiOperation({ summary: 'How I share: exact, nearby or paused, for how long, and the weekly recap' })
  settings(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(LocationSettingsSchema)) body: any) {
    return this.location.setSettings(user.id, body);
  }

  @Post('/me/trip')
  @ApiOperation({ summary: 'Tell the family I am heading to a place' })
  startTrip(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(TripSchema)) body: any) {
    return this.location.startTrip(user, body);
  }

  @Delete('/me/trip')
  @ApiOperation({ summary: 'Cancel my trip' })
  async endTrip(@CurrentUser() user: RequestUser) {
    await this.location.endTrip(user.id);
    return { ok: true };
  }

  @Post('/poke')
  @ApiOperation({ summary: 'Send a family member a quick sticker' })
  poke(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(PokeSchema)) body: any) {
    return this.location.poke(user, body);
  }

  @Post('/places')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Add a family place (parent)' })
  createPlace(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(PlaceInputSchema)) body: any) {
    return this.places.create(tenantId, body);
  }

  @Patch('/places/:id')
  @UseGuards(AdminGuard)
  @ApiParam({ name: 'id' })
  updatePlace(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body(new ZodValidationPipe(UpdatePlaceSchema)) body: any) {
    return this.places.update(tenantId, id, body);
  }

  @Delete('/places/:id')
  @UseGuards(AdminGuard)
  @ApiParam({ name: 'id' })
  removePlace(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.places.remove(tenantId, id);
  }

  @Get('/places')
  listPlaces(@CurrentTenant() tenantId: string) {
    return this.places.list(tenantId);
  }

  @Post('/errands')
  @ApiOperation({ summary: 'Drop a pin with a task on it' })
  createErrand(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(ErrandInputSchema)) body: any) {
    return this.errands.create(user, body);
  }

  @Post('/errands/:id/claim')
  @ApiParam({ name: 'id' })
  claimErrand(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.errands.claim(user, id);
  }

  @Post('/errands/:id/release')
  @ApiParam({ name: 'id' })
  releaseErrand(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.errands.release(user, id);
  }

  @Post('/errands/:id/done')
  @ApiParam({ name: 'id' })
  doneErrand(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.errands.done(user, id);
  }

  @Delete('/errands/:id')
  @ApiParam({ name: 'id' })
  removeErrand(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.errands.remove(user, id);
  }

  @Post('/tags')
  @ApiOperation({ summary: 'Put a thing on the map: the dog, a bike, the car' })
  createTag(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(MapTagInputSchema)) body: any) {
    return this.tags.create(user, body);
  }

  @Patch('/tags/:id')
  @ApiParam({ name: 'id' })
  updateTag(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodValidationPipe(UpdateMapTagSchema)) body: any) {
    return this.tags.update(user, id, body);
  }

  @Delete('/tags/:id')
  @ApiParam({ name: 'id' })
  removeTag(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.tags.remove(tenantId, id);
  }
}
