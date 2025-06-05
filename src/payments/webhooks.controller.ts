// src/payments/webhooks.controller.ts
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
import { SubscriptionType } from '../subscriptions/dto/create-subscription.dto';
import { LencoService } from '../lenco/lenco.service';
import * as crypto from 'crypto';
import { FastifyRequest } from 'fastify';
import { PromotionsService } from 'src/promotions/promotions.service'; // Add this line

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly lencoWebhookHashKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly lencoService: LencoService,
    private readonly promotionsService: PromotionsService, 
  ) {
    const lencoApiToken = this.configService.get<string>('LENCO_SECRET_KEY');
    if (lencoApiToken) {
      this.lencoWebhookHashKey = crypto
        .createHash('sha256')
        .update(lencoApiToken.trim())
        .digest('hex');
    } else {
      this.logger.error(
        'LENCO_SECRET_KEY is not configured. Webhook verification will fail.',
      );
      this.lencoWebhookHashKey = '';
    }
  }

  @Post('lenco/callback')
  @HttpCode(HttpStatus.OK)
  async handleLencoCallback(
    @Req() req: FastifyRequest,
    @Body() callbackData: any,
    @Headers('x-lenco-signature') signature: string,
  ) {
    this.logger.log(
      `Received Lenco webhook: ${JSON.stringify(callbackData)}`,
    );

    const rawRequestBody = (req as any).rawBodyString as string | undefined;

    if (rawRequestBody === undefined) {
      this.logger.error(
        'Raw body string not available for Lenco webhook signature verification.',
      );
      throw new BadRequestException(
        'Internal server error: Raw body string missing.',
      );
    }

    const isValidSignature = this.lencoService.verifyWebhookSignature(
      rawRequestBody,
      signature,
      this.lencoWebhookHashKey,
    );

    if (!isValidSignature && this.lencoWebhookHashKey) {
      this.logger.warn('Invalid Lenco webhook signature.');
      throw new BadRequestException('Invalid signature');
    } else if (!this.lencoWebhookHashKey) {
      this.logger.error(
        'Webhook verification skipped due to missing LENCO_SECRET_KEY configuration.',
      );
    }

    const eventType = callbackData.event?.toLowerCase();
    const data = callbackData.data;

    if (!data || !data.reference || !data.status || !eventType) {
      this.logger.warn(
        'Lenco webhook missing critical data: reference, status, or event type.',
      );
      return { status: 'error', message: 'Missing critical data' };
    }

    const paymentReference = data.reference;
    // const statusFromWebhook = data.status?.toLowerCase(); // statusFromWebhook is used inside service methods

    this.logger.log(
      `Processing Lenco webhook event: ${eventType} for ref: ${paymentReference} with Lenco status: ${data.status?.toLowerCase()}`,
    );

    if (paymentReference.startsWith('PROMO-')) {
      this.logger.log(
        `Delegating promotion webhook for reference: ${paymentReference} to PromotionsService.`,
      );
      await this.promotionsService.handleLencoWebhook(callbackData); // Modified line
    } else if (paymentReference.startsWith('SUB_')) {
      const referenceMatch = paymentReference.match(/^SUB_([^_]+)_/);
      if (!referenceMatch) {
        this.logger.error(
          `Lenco Webhook: Invalid reference format for subscription: ${paymentReference}`,
        );
        return { status: 'error', message: 'Invalid reference format' };
      }
      const userId = referenceMatch[1];
      const statusFromWebhook = data.status?.toLowerCase(); // Get status here for subscriptions

      if (
        eventType.includes('collection.successful') ||
        eventType.includes('collection.settled') ||
        statusFromWebhook === 'successful'
      ) {
        this.logger.log(
          `Lenco Webhook: Subscription payment successful for user ${userId}, ref: ${paymentReference}`,
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
              amount_paid: parseFloat(data.amount || '0'),
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
          `Lenco Webhook: Subscription payment failed for user ${userId}, ref: ${paymentReference}`,
        );
      } else {
        this.logger.log(
          `Lenco Webhook: Received status ${statusFromWebhook} for subscription user ${userId}, ref: ${paymentReference}. No specific action taken.`,
        );
      }
    } else {
      this.logger.warn(
        `Lenco Webhook: Unknown reference prefix for ${paymentReference}. Ignoring.`,
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