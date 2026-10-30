import { Module } from '@nestjs/common';
import { InstancesController } from './instances.controller';
import { InstancesService } from './instances.service';
import { PrismaModule } from '../prisma.module';
import { ChoresModule } from '../chores/chores.module';
import { ProofsModule } from '../proofs/proofs.module';

@Module({
  imports: [PrismaModule, ChoresModule, ProofsModule],
  controllers: [InstancesController],
  providers: [InstancesService],
  exports: [InstancesService],
})
export class InstancesModule {}
