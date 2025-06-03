// src/payments/payments.service.ts
import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LencoService } from '../lenco/lenco.service';
import { ZynleService } from '../zynle/zynle.service';
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
    private readonly zynleService: ZynleService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    // Get payment provider from environment
    this.currentProvider = this.configService.get<PaymentProvider>(
      'PAYMENT_PROVIDER',
      PaymentProvider.LENCO, // Default fallback
    );
    
    this.logger.log(`Payment provider configured as: ${this.currentProvider}`);
  }

  async initiatePayment(userId: string, dto: InitiatePaymentDto) {
    try {
      const reference = `SUB_${userId}_${Date.now()}`;
      
      if (this.currentProvider === PaymentProvider.ZYNLE) {
        return this.initiateZynlePayment(reference, dto);
      } else {
        return this.initiateLencoPayment(reference, dto);
      }
    } catch (error: any) {
      this.logger.error(
        `Payment initiation failed for user ${userId} with provider ${this.currentProvider}:`,
        error,
      );
      throw new InternalServerErrorException(
        error.message || 'Payment initiation failed'
      );
    }
  }

  private async initiateLencoPayment(reference: string, dto: InitiatePaymentDto) {
    // Lenco only supports mobile money
    if (dto.method === PaymentMethod.CARD) {
      throw new BadRequestException('Card payments not supported with Lenco provider');
    }

    const result = await this.lencoService.initiateMobileMoneyCollection({
      amount: dto.amount,
      reference: reference,
      phone: dto.phone,
      operator: dto.operator || 'mtn',
      country: 'ZM',
      bearer: 'customer',
    });

    this.logger.log(`Lenco payment initiated, reference: ${reference}`);

    return {
      provider: PaymentProvider.LENCO,
      reference: result.reference,
      lencoReference: result.lencoReference,
      status: result.status,
      message: 'Payment initiated successfully with Lenco',
      requiresOtp: true, // Lenco requires OTP submission
    };
  }

  private async initiateZynlePayment(reference: string, dto: InitiatePaymentDto) {
    const result = await this.zynleService.initiateMobileMoneyCollection({
      amount: dto.amount,
      reference: reference,
      phone: dto.phone,
      operator: dto.operator || 'mtn',
      method: dto.method || PaymentMethod.MOMO,
      email: dto.email,
      first_name: dto.first_name,
      last_name: dto.last_name,
      address: dto.address,
      city: dto.city,
      state: dto.state,
      zip_code: dto.zip_code,
      country: dto.country,
      description: dto.description,
    });

    this.logger.log(`Zynle payment initiated, reference: ${reference}`);

    return {
      provider: PaymentProvider.ZYNLE,
      reference: result.reference,
      transaction_id: result.transaction_id,
      status: result.status,
      redirect_url: result.redirect_url, // For card payments
      operator: result.operator,
      message: result.message,
      requiresOtp: false, // Zynle doesn't require separate OTP submission
    };
  }

  async submitOtp(userId: string, dto: SubmitOtpDto) {
    // OTP submission only applies to Lenco
    if (this.currentProvider !== PaymentProvider.LENCO) {
      throw new BadRequestException(`OTP submission not supported with ${this.currentProvider} provider`);
    }

    try {
      const result = await this.lencoService.submitOtp(dto.reference, dto.otp);

      this.logger.log(
        `OTP submitted for user ${userId}, reference: ${dto.reference}, status: ${result.status}`,
      );

      const isConsideredSuccessful =
        result.status === 'successful' ||
        result.status === 'completed' ||
        result.status === 'paid' ||
        (process.env.NODE_ENV !== 'production' && result.status === 'pay-offline');

      if (isConsideredSuccessful) {
        await this.createSubscriptionAfterPayment(userId, dto.reference);
      }

      return {
        provider: PaymentProvider.LENCO,
        status: result.status,
        reference: result.reference,
        lencoReference: result.lencoReference,
        message: 'OTP submitted successfully',
        subscriptionCreated: isConsideredSuccessful,
      };
    } catch (error: any) {
      this.logger.error(`OTP submission failed for user ${userId}:`, error);
      throw new BadRequestException(error.message || 'OTP verification failed');
    }
  }

  async verifyPayment(userId: string, reference: string) {
    try {
      if (this.currentProvider === PaymentProvider.ZYNLE) {
        return this.verifyZynlePayment(userId, reference);
      } else {
        return this.verifyLencoPayment(userId, reference);
      }
    } catch (error: any) {
      this.logger.error(
        `Payment verification failed for user ${userId} with provider ${this.currentProvider}:`,
        error,
      );
      throw new InternalServerErrorException(
        error.message || 'Payment verification failed'
      );
    }
  }

  private async verifyZynlePayment(userId: string, reference: string) {
    const result = await this.zynleService.verifyPayment(reference);
    
    if (!result) {
      throw new BadRequestException('Payment verification failed');
    }

    // Check if payment is successful
    if (this.zynleService.isPaymentSuccessful(result.response_code)) {
      const existingSubscription = await this.subscriptionsService.getUserActiveSubscription(userId);
      
      if (!existingSubscription || !this.wasCreatedFromPayment(existingSubscription, reference)) {
        await this.createSubscriptionAfterPayment(userId, reference);
      }
    }

    return {
      provider: PaymentProvider.ZYNLE,
      status: this.mapZynleStatusToReadable(result.response_code),
      response_code: result.response_code,
      reference: result.reference_no,
      message: result.message,
    };
  }

  private async verifyLencoPayment(userId: string, reference: string) {
    const result = await this.lencoService.verifyPayment(reference);
    
    if (!result) {
      throw new BadRequestException('Payment verification failed');
    }

    if (result.status === 'successful' || result.status === 'completed' || result.status === 'paid') {
      const existingSubscription = await this.subscriptionsService.getUserActiveSubscription(userId);
      
      if (!existingSubscription || !this.wasCreatedFromPayment(existingSubscription, reference)) {
        await this.createSubscriptionAfterPayment(userId, reference, parseFloat(result.amount));
      }
    }

    return {
      provider: PaymentProvider.LENCO,
      status: result.status,
      reference: result.reference,
      amount: result.amount,
      message: 'Payment verified successfully',
    };
  }

  getCurrentProvider(): PaymentProvider {
    return this.currentProvider;
  }

  private mapZynleStatusToReadable(responseCode: string): string {
    switch (responseCode) {
      case '100': return 'successful';
      case '120': return 'initiated';
      case '990': return 'pending';
      case '995': return 'failed';
      default: return 'unknown';
    }
  }

  private async createSubscriptionAfterPayment(userId: string, paymentReference: string, amount?: number) {
    try {
      const existingSubscriptions = await this.subscriptionsService.getUserSubscriptions(userId);
      const existingWithPaymentRef = existingSubscriptions.find(
        sub => sub.payment_reference === paymentReference
      );

      if (existingWithPaymentRef) {
        this.logger.log(`Subscription already exists for payment reference ${paymentReference}`);
        return existingWithPaymentRef;
      }

      const subscription = await this.subscriptionsService.createSubscription(userId, {
        subscription_type: SubscriptionType.BASIC,
        duration_months: 1,
        payment_reference: paymentReference,
        amount_paid: amount || 129,
        currency: 'ZMW',
      });

      this.logger.log(
        `Subscription created successfully for user ${userId}, payment reference: ${paymentReference}, provider: ${this.currentProvider}`,
      );
      return subscription;
    } catch (error: any) {
      this.logger.error(`Failed to create subscription after payment for user ${userId}:`, error);
    }
  }

  private wasCreatedFromPayment(subscription: any, paymentReference: string): boolean {
    return subscription.payment_reference === paymentReference;
  }
}