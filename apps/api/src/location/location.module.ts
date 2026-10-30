import { Module } from '@nestjs/common';
import { ErrandsService } from './errands.service';
import { GeocodeService } from './geocode.service';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { PlacesService } from './places.service';
import { TagsService } from './tags.service';

@Module({
  controllers: [LocationController],
  providers: [LocationService, PlacesService, ErrandsService, TagsService, GeocodeService],
})
export class LocationModule {}
