import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LencoService } from './lenco.service';

@Module({
  imports: [ConfigModule],
  providers: [LencoService],
  exports: [LencoService],
})
export class LencoModule {}
