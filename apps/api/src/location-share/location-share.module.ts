import { Module } from '@nestjs/common';
import { LocationModule } from '../location/location.module';
import { PrismaModule } from '../prisma.module';
import { UsersModule } from '../users/users.module';
import { LocationShareController } from './location-share.controller';
import { LocationShareService } from './location-share.service';

@Module({
  imports: [PrismaModule, LocationModule, UsersModule],
  controllers: [LocationShareController],
  providers: [LocationShareService],
})
export class LocationShareModule {}
