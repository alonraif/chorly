import { Module } from '@nestjs/common';
import { InstancesController } from './instances.controller';
import { InstancesService } from './instances.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InstancesController],
  providers: [InstancesService],
  exports: [InstancesService],
})
export class InstancesModule {}
