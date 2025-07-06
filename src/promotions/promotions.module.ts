// src/promotions/promotions.module.ts
import { Module } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { LencoModule } from '../lenco/lenco.module';
import { ZynleModule } from '../zynle/zynle.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [SupabaseModule, LencoModule, ZynleModule, ConfigModule],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService]
})
export class PromotionsModule {}