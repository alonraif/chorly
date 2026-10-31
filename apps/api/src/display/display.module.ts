import { Module } from '@nestjs/common';
import { InstancesModule } from '../instances/instances.module';
import { PrismaModule } from '../prisma.module';
import { UsersModule } from '../users/users.module';
import { DisplayController } from './display.controller';
import { DisplayService } from './display.service';

@Module({
  imports: [PrismaModule, InstancesModule, UsersModule],
  controllers: [DisplayController],
  providers: [DisplayService],
})
export class DisplayModule {}
