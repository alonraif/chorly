import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { SystemController } from './system.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SystemController],
})
export class SystemModule {}
