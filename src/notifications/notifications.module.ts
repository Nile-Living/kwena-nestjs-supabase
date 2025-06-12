// src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [SupabaseModule, ScheduleModule.forRoot(), SubscriptionsModule, ConfigModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
