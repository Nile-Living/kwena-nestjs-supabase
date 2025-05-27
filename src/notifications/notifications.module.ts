// src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [SupabaseModule, ScheduleModule.forRoot()],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
