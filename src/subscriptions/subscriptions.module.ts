// src/subscriptions/subscriptions.module.ts
import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [SupabaseModule, ScheduleModule.forRoot()],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
