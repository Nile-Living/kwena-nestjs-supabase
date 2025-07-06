// src/zynle/zynle.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ZynleService } from './zynle.service';

@Module({
  imports: [ConfigModule],
  providers: [ZynleService],
  exports: [ZynleService],
})
export class ZynleModule {}