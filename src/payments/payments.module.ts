import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { LencoModule } from '../lenco/lenco.module';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { WebhooksController } from './webhooks.controller';
import { PromotionsModule } from 'src/promotions/promotions.module';

@Module({
  imports: [LencoModule, SubscriptionsModule, SupabaseModule, PromotionsModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}