import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Headers,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentProvider } from './enums/payment-provider.enums';
import { SubscriptionType } from '../subscriptions/dto/create-subscription.dto';
import { LencoService } from '../lenco/lenco.service'; // Import LencoService

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly currentProvider: PaymentProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly lencoService: LencoService, // Inject LencoService
  ) {
    this.currentProvider = this.configService.get<PaymentProvider>(
      'PAYMENT_PROVIDER',
      PaymentProvider.LENCO,
    );
  }

  @Post('lenco/callback')
  @HttpCode(HttpStatus.OK)
  async handleLencoCallback(
    @Body() callbackData: any,
    @Headers('x-lenco-signature') signature: string,
  ) {
    this.logger.log(
      `Received Lenco webhook for subscriptions: ${JSON.stringify(
        callbackData,
      )}`,
    );

    // TODO: Implement Lenco signature verification
    // const isValid = this.lencoService.verifyWebhookSignature(callbackData, signature);
    // if (!isValid) {
    //   this.logger.warn('Invalid Lenco webhook signature for subscriptions.');
    //   throw new BadRequestException('Invalid signature');
    // }

    const eventType = callbackData.event?.toLowerCase();
    const data = callbackData.data;

    if (!data || !data.reference || !data.status || !eventType) {
      this.logger.warn(
        'Lenco subscription webhook missing critical data: reference, status, or event type.',
      );
      return { status: 'error', message: 'Missing critical data' };
    }
    
    const paymentReference = data.reference;

    // Ignore if it's a promotion webhook
    if (paymentReference.startsWith('PROMO-')) {
        this.logger.log(`Lenco webhook for ref ${paymentReference} is a promotion. Subscription webhook ignoring.`);
        return { status: 'ignored', message: 'Promotion event' };
    }

    const lencoApiReference = data.lencoReference;
    const statusFromWebhook = data.status?.toLowerCase();

    this.logger.log(
      `Processing Lenco webhook event: ${eventType} for subscription_ref: ${paymentReference} with Lenco status: ${statusFromWebhook}`,
    );

    const referenceMatch = paymentReference.match(/^SUB_([^_]+)_/);
    if (!referenceMatch) {
      this.logger.error(
        `Lenco Webhook: Invalid reference format for subscription: ${paymentReference}`,
      );
      return { status: 'error', message: 'Invalid reference format' };
    }
    const userId = referenceMatch[1];

    if (
      eventType.includes('collection.successful') ||
      eventType.includes('collection.settled') ||
      statusFromWebhook === 'successful'
    ) {
      this.logger.log(
        `Lenco Webhook: Payment successful for user ${userId}, ref: ${paymentReference}`,
      );
      try {
        const existingSubscription =
          await this.subscriptionsService.getUserActiveSubscription(userId);
        if (
          !existingSubscription ||
          existingSubscription.payment_reference !== paymentReference ||
          existingSubscription.status !== 'active'
        ) {
          await this.subscriptionsService.createSubscription(userId, {
            subscription_type: SubscriptionType.BASIC,
            duration_months: 1,
            payment_reference: paymentReference,
            amount_paid: parseFloat(data.amount || '129'),
            currency: data.currency || 'ZMW',
          });
          this.logger.log(
            `Lenco Webhook: Subscription created/updated for user ${userId}, ref: ${paymentReference}`,
          );
        } else {
            this.logger.log(
            `Lenco Webhook: Subscription already active for user ${userId}, ref: ${paymentReference}. No action needed.`,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Lenco Webhook: Error creating/updating subscription for user ${userId}, ref ${paymentReference}:`,
          error,
        );
      }
    } else if (
      eventType.includes('collection.failed') ||
      statusFromWebhook === 'failed'
    ) {
      this.logger.log(
        `Lenco Webhook: Payment failed for user ${userId}, ref: ${paymentReference}`,
      );
      // Optionally, update subscription status to 'failed' or handle accordingly
    } else {
      this.logger.log(
        `Lenco Webhook: Received status ${statusFromWebhook} for user ${userId}, ref: ${paymentReference}. No specific action taken.`,
      );
    }

    return { status: 'success', message: 'Lenco callback processed' };
  }

  @Post('zynle/callback')
  @HttpCode(HttpStatus.OK)
  async handleZynleCallback(
    @Body() callbackData: any,
    @Headers() headers: any,
  ) {
    this.logger.log(
      'Received Zynle callback, but Lenco is the active provider. Ignoring.',
    );
    return { status: 'ignored', message: 'Provider mismatch, Lenco is active' };
  }
}