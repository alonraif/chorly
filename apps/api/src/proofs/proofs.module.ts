import { Module } from '@nestjs/common';
import { ProofsService } from './proofs.service';

@Module({
  providers: [ProofsService],
  exports: [ProofsService],
})
export class ProofsModule {}
