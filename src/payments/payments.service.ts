import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
import { LencoService } from '../lenco/lenco.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InitiatePaymentDto, PaymentMethod } from './dto/initiate-payment.dto';
import { SubmitOtpDto } from './dto/submit-otp.dto';
import { PaymentProvider } from './enums/payment-provider.enums';
import { SubscriptionType } from '../subscriptions/dto/create-subscription.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly currentProvider: PaymentProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly lencoService: LencoService,
    private readonly subscriptionsService: SubscriptionsService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {
    this.currentProvider = this.configService.get<PaymentProvider>(
      'PAYMENT_PROVIDER',
      PaymentProvider.LENCO,
    );
    this.logger.log(`Payment provider configured as: ${this.currentProvider}`);
  }

  async initiatePayment(userId: string, dto: InitiatePaymentDto) {
    if (this.currentProvider !== PaymentProvider.LENCO) {
      throw new BadRequestException(
        `Payment provider ${this.currentProvider} not supported for this operation. Lenco is required.`,
      );
    }
    if (dto.method === PaymentMethod.CARD) {
      throw new BadRequestException(
        'Card payments via Lenco are not directly supported through this service yet. Please use Mobile Money.',
      );
    }

    try {
      const reference = `SUB_${userId}_${Date.now()}`;
      const lencoResponse =
        await this.lencoService.initiateMobileMoneyCollection({
          amount: dto.amount,
          reference: reference,
          phone: dto.phone,
          operator: dto.operator || 'mtn',
          country: 'ZM',
          bearer: 'customer',
        });

      this.logger.log(
        `Lenco payment initiation for subscription: ref ${reference}, Lenco ref ${lencoResponse.lencoReference}, status ${lencoResponse.status}`,
      );

      return {
        provider: PaymentProvider.LENCO,
        reference: lencoResponse.reference,
        lencoReference: lencoResponse.lencoReference,
        status: lencoResponse.status,
        message: `Payment initiated with Lenco. Status: ${lencoResponse.status}`,
        requiresOtp: lencoResponse.status === 'otp-required',
      };
    } catch (error: any) {
      this.logger.error(
        `Lenco payment initiation failed for user ${userId}:`,
        error,
      );
      throw new InternalServerErrorException(
        error.message || 'Payment initiation failed with Lenco',
      );
    }
  }

  async submitOtp(userId: string, dto: SubmitOtpDto) {
    if (this.currentProvider !== PaymentProvider.LENCO) {
      throw new BadRequestException(
        `OTP submission not supported with ${this.currentProvider} provider. Lenco is required.`,
      );
    }

    try {
      this.logger.log(`Submitting OTP for Lenco payment: ref ${dto.reference}`);
      await this.lencoService.submitOtp(dto.reference, dto.otp);

      this.logger.log(
        `OTP submitted for Lenco ref ${dto.reference}. Verifying final status.`,
      );
      const verificationResult = await this.lencoService.verifyPayment(
        dto.reference,
      );

      if (!verificationResult) {
        throw new BadRequestException(
          'Failed to verify payment status after OTP submission.',
        );
      }

      this.logger.log(
        `Lenco payment status after OTP for user ${userId}, ref: ${dto.reference}, status: ${verificationResult.status}`,
      );

      let subscriptionCreated = false;
      if (verificationResult.status === 'successful') {
        await this.createSubscriptionAfterPayment(
          userId,
          dto.reference,
          parseFloat(verificationResult.amount),
        );
        subscriptionCreated = true;
      }

      return {
        provider: PaymentProvider.LENCO,
        status: verificationResult.status,
        reference: verificationResult.reference,
        lencoReference: verificationResult.lencoReference,
        amount: verificationResult.amount,
        message: `Lenco payment status after OTP: ${verificationResult.status}`,
        subscriptionCreated,
      };
    } catch (error: any) {
      this.logger.error(
        `Lenco OTP submission/verification failed for user ${userId}, ref ${dto.reference}:`,
        error,
      );
      throw new InternalServerErrorException(
        error.message || 'Lenco OTP processing failed',
      );
    }
  }

  async verifyPayment(userId: string, reference: string) {
    if (this.currentProvider !== PaymentProvider.LENCO) {
      throw new BadRequestException(
        `Payment verification not supported with ${this.currentProvider} provider. Lenco is required.`,
      );
    }

    try {
      const result = await this.lencoService.verifyPayment(reference);
      if (!result) {
        throw new BadRequestException(
          'Payment verification failed with Lenco or payment not found.',
        );
      }

      this.logger.log(
        `Lenco payment verification for user ${userId}, ref: ${reference}, status: ${result.status}`,
      );

      if (result.status === 'successful') {
        // Use a more robust subscription creation/update approach
        await this.ensureSubscriptionExists(
          userId,
          reference,
          parseFloat(result.amount),
        );
      }

      return {
        provider: PaymentProvider.LENCO,
        status: result.status,
        reference: result.reference,
        lencoReference: result.lencoReference,
        amount: result.amount,
        currency: result.currency,
        fee: result.fee,
        settlementStatus: result.settlementStatus,
        message: `Lenco payment status: ${result.status}`,
      };
    } catch (error: any) {
      this.logger.error(
        `Lenco payment verification failed for user ${userId}, ref ${reference}:`,
        error,
      );
      throw new InternalServerErrorException(
        error.message || 'Lenco payment verification failed',
      );
    }
  }

  private async ensureSubscriptionExists(
    userId: string,
    paymentReference: string,
    amount?: number,
  ): Promise<void> {
    try {
      // Check if subscription already exists with this payment reference
      const existingSubscription =
        await this.subscriptionsService.getSubscriptionByPaymentReference(
          paymentReference,
        );

      if (existingSubscription && existingSubscription.status === 'active') {
        this.logger.log(
          `Subscription already exists for payment reference ${paymentReference}`,
        );
        return;
      }

      // Check if user has any other active subscription
      const activeSubscription =
        await this.subscriptionsService.getUserActiveSubscription(userId);

      if (
        activeSubscription &&
        activeSubscription.payment_reference !== paymentReference
      ) {
        this.logger.log(
          `User ${userId} already has an active subscription with different payment reference. Skipping creation.`,
        );
        return;
      }

      // Create new subscription
      const subscription = await this.subscriptionsService.createSubscription(
        userId,
        {
          subscription_type: SubscriptionType.BASIC,
          duration_months: 1,
          payment_reference: paymentReference,
          amount_paid: amount || 129,
          currency: 'ZMW',
        },
      );

      this.logger.log(
        `Subscription created for user ${userId}, payment reference: ${paymentReference}, subscription ID: ${subscription.id}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to ensure subscription exists for user ${userId}, ref ${paymentReference}:`,
        error,
      );
    }
  }

  getCurrentProvider(): PaymentProvider {
    return this.currentProvider;
  }

  private async createSubscriptionAfterPayment(
    userId: string,
    paymentReference: string,
    amount?: number,
  ) {
    try {
      const existingSubscriptions =
        await this.subscriptionsService.getUserSubscriptions(userId);
      const existingWithPaymentRef = existingSubscriptions.find(
        (sub) => sub.payment_reference === paymentReference,
      );

      if (
        existingWithPaymentRef &&
        existingWithPaymentRef.status === 'active'
      ) {
        this.logger.log(
          `Subscription already active for payment reference ${paymentReference}`,
        );
        return existingWithPaymentRef;
      }

      const subscription = await this.subscriptionsService.createSubscription(
        userId,
        {
          subscription_type: SubscriptionType.BASIC,
          duration_months: 1,
          payment_reference: paymentReference,
          amount_paid: amount || 1,
          currency: 'ZMW',
        },
      );

      this.logger.log(
        `Subscription created/updated for user ${userId}, payment reference: ${paymentReference}, provider: ${this.currentProvider}`,
      );
      return subscription;
    } catch (error: any) {
      this.logger.error(
        `Failed to create subscription after payment for user ${userId}, ref ${paymentReference}:`,
        error,
      );
    }
  }

  private wasCreatedFromPayment(
    subscription: any,
    paymentReference: string,
  ): boolean {
    return subscription.payment_reference === paymentReference;
  }
}
