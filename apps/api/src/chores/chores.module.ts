import { Module } from '@nestjs/common';
import { ChoresController } from './chores.controller';
import { ChoresService } from './chores.service';
import { PrismaModule } from '../prisma.module';
import { ProofsModule } from '../proofs/proofs.module';

@Module({
  imports: [PrismaModule, ProofsModule],
  controllers: [ChoresController],
  providers: [ChoresService],
  exports: [ChoresService],
})
export class ChoresModule {}
