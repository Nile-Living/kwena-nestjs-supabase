// src/payments/payments.module.ts
import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { LencoModule } from '../lenco/lenco.module';
import { ZynleModule } from 'src/zynle/zynle.module';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';
import { WebhooksController } from './webhooks.controller';
import { PromotionsModule } from 'src/promotions/promotions.module';

@Module({
  imports: [LencoModule, ZynleModule, SubscriptionsModule, PromotionsModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}