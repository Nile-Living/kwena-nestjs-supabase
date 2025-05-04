import { Module } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';
import { SupabaseModule } from '../supabase/supabase.module';
import { LencoModule } from '../lenco/lenco.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [SupabaseModule, LencoModule, ConfigModule],
  controllers: [PromotionsController],
  providers: [PromotionsService],
})
export class PromotionsModule {}
