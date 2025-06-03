// src/payments/webhooks.controller.ts
import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    Logger,
    Headers,
  } from '@nestjs/common';
  import { ConfigService } from '@nestjs/config';
  import { PaymentsService } from './payments.service';
  import { SubscriptionsService } from '../subscriptions/subscriptions.service';
  import { ZynleCallbackResponse } from '../zynle/interfaces/zynle.interfaces';
  import { PaymentProvider } from './enums/payment-provider.enums';
  import { SubscriptionType } from '../subscriptions/dto/create-subscription.dto';
  
  @Controller('webhooks')
  export class WebhooksController {
    private readonly logger = new Logger(WebhooksController.name);
    private readonly currentProvider: PaymentProvider;
  
    constructor(
      private readonly configService: ConfigService,
      private readonly paymentsService: PaymentsService,
      private readonly subscriptionsService: SubscriptionsService,
    ) {
      this.currentProvider = this.configService.get<PaymentProvider>(
        'PAYMENT_PROVIDER',
        PaymentProvider.LENCO,
      );
    }
  
    @Post('zynle/callback')
    @HttpCode(HttpStatus.OK)
    async handleZynleCallback(
      @Body() callbackData: ZynleCallbackResponse,
      @Headers() headers: any,
    ) {
      // Only process if current provider is Zynle
      if (this.currentProvider !== PaymentProvider.ZYNLE) {
        this.logger.warn(`Received Zynle callback but current provider is ${this.currentProvider}`);
        return { status: 'ignored', message: 'Provider mismatch' };
      }
  
      this.logger.log(
        `Received Zynle callback for reference: ${callbackData.reference_no}`,
      );
      this.logger.debug(`Callback data: ${JSON.stringify(callbackData)}`);
  
      try {
        // Extract user ID from reference (assuming format: SUB_userId_timestamp)
        const referenceMatch = callbackData.reference_no.match(/^SUB_([^_]+)_/);
        if (!referenceMatch) {
          this.logger.error(`Invalid reference format: ${callbackData.reference_no}`);
          return { status: 'error', message: 'Invalid reference format' };
        }
  
        const userId = referenceMatch[1];
  
        // Check if payment is successful
        if (callbackData.response_code === '100') {
          this.logger.log(
            `Payment successful for user ${userId}, reference: ${callbackData.reference_no}`,
          );
  
          // Check if subscription already exists for this payment
          const existingSubscriptions = await this.subscriptionsService.getUserSubscriptions(userId);
          const existingWithPaymentRef = existingSubscriptions.find(
            sub => sub.payment_reference === callbackData.reference_no
          );
  
          if (!existingWithPaymentRef) {
            await this.subscriptionsService.createSubscription(userId, {
              subscription_type: SubscriptionType.BASIC,
              duration_months: 1,
              payment_reference: callbackData.reference_no,
              amount_paid: parseFloat(callbackData.amount || '129'),
              currency: callbackData.currency || 'ZMW',
            });
  
            this.logger.log(
              `Subscription created from Zynle callback for user ${userId}, reference: ${callbackData.reference_no}`,
            );
          }
        } else if (callbackData.response_code === '995') {
          this.logger.log(
            `Payment failed for user ${userId}, reference: ${callbackData.reference_no}`,
          );
        } else {
          this.logger.log(
            `Payment status ${callbackData.response_code} for user ${userId}, reference: ${callbackData.reference_no}`,
          );
        }
  
        return { status: 'success', message: 'Callback processed' };
      } catch (error: any) {
        this.logger.error(
          `Error processing Zynle callback for reference ${callbackData.reference_no}:`,
          error,
        );
        return { status: 'error', message: 'Internal server error' };
      }
    }
  
    @Post('lenco/callback')
    @HttpCode(HttpStatus.OK)
    async handleLencoCallback(@Body() callbackData: any) {
      // Only process if current provider is Lenco
      if (this.currentProvider !== PaymentProvider.LENCO) {
        this.logger.warn(`Received Lenco callback but current provider is ${this.currentProvider}`);
        return { status: 'ignored', message: 'Provider mismatch' };
      }
  
      this.logger.log(`Received Lenco callback: ${JSON.stringify(callbackData)}`);
      
      // Add your Lenco callback handling logic here
      return { status: 'success', message: 'Callback processed' };
    }
  }