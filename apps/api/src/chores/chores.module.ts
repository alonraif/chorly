import { Module } from '@nestjs/common';
import { ChoresController } from './chores.controller';
import { ChoresService } from './chores.service';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ChoresController],
  providers: [ChoresService],
  exports: [ChoresService],
})
export class ChoresModule {}
