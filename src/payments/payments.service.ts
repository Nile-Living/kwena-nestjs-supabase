// src/payments/payments.service.ts
import {
    Injectable,
    Logger,
    InternalServerErrorException,
    BadRequestException,
  } from '@nestjs/common';
  import { LencoService } from '../lenco/lenco.service';
  import { SubscriptionsService } from '../subscriptions/subscriptions.service';
  import { InitiatePaymentDto } from './dto/initiate-payment.dto';
  import { SubmitOtpDto } from './dto/submit-otp.dto';
  import { SubscriptionType } from '../subscriptions/dto/create-subscription.dto';
  
  @Injectable()
  export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);
  
    constructor(
      private readonly lencoService: LencoService,
      private readonly subscriptionsService: SubscriptionsService,
    ) {}
  
    async initiatePayment(userId: string, dto: InitiatePaymentDto) {
      try {
        const reference = `SUB_${userId}_${Date.now()}`;
        
        const result = await this.lencoService.initiateMobileMoneyCollection({
          amount: dto.amount,
          reference: reference,
          phone: dto.phone,
          operator: dto.operator || 'mtn',
          country: 'ZM',
          bearer: 'customer',
        });
  
        this.logger.log(`Payment initiated for user ${userId}, reference: ${reference}`);
  
        return {
          reference: result.reference,
          lencoReference: result.lencoReference,
          status: result.status,
          message: 'Payment initiated successfully',
        };
      } catch (error: any) {
        this.logger.error(`Payment initiation failed for user ${userId}:`, error);
        throw new InternalServerErrorException(
          error.message || 'Payment initiation failed'
        );
      }
    }
  
    async submitOtp(userId: string, dto: SubmitOtpDto) {
      try {
        const result = await this.lencoService.submitOtp(dto.reference, dto.otp);
  
        this.logger.log(
          `OTP submitted for user ${userId}, reference: ${dto.reference}, status: ${result.status}`,
        );
  
        // --- MODIFICATION FOR SANDBOX ---
        // Treat 'pay-offline' as successful for subscription creation in sandbox
        const isConsideredSuccessful =
          result.status === 'successful' ||
          result.status === 'completed' ||
          result.status === 'paid' ||
          (process.env.NODE_ENV !== 'production' && // Optional: Gate this by environment
            result.status === 'pay-offline');
        // --- END MODIFICATION ---
  
        if (isConsideredSuccessful) {
          this.logger.log(
            `Payment status '${result.status}' for ${dto.reference}. Proceeding to create subscription.`,
          );
          await this.createSubscriptionAfterPayment(userId, dto.reference);
        } else if (result.status === 'pending') {
          // For pending payments, we might need to verify later
          this.logger.log(
            `Payment pending for user ${userId}, reference: ${dto.reference}`,
          );
        } else {
          this.logger.log(
            `Payment status for ${dto.reference} is '${result.status}'. No subscription created at this stage.`,
          );
        }
  
        return {
          status: result.status,
          reference: result.reference,
          lencoReference: result.lencoReference, // Pass along lencoReference if available
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
        const result = await this.lencoService.verifyPayment(reference);
  
        if (!result) {
          throw new BadRequestException('Payment verification failed');
        }
  
        this.logger.log(`Payment verification for user ${userId}, reference: ${reference}, status: ${result.status}`);
  
        // Create subscription if payment is successful and not already created
        if (result.status === 'successful' || result.status === 'completed' || result.status === 'paid') {
          const existingSubscription = await this.subscriptionsService.getUserActiveSubscription(userId);
          
          if (!existingSubscription || !this.wasCreatedFromPayment(existingSubscription, reference)) {
            await this.createSubscriptionAfterPayment(userId, reference, parseFloat(result.amount));
          }
        }
  
        return {
          status: result.status,
          reference: result.reference,
          amount: result.amount,
          message: 'Payment verified successfully',
        };
      } catch (error: any) {
        this.logger.error(`Payment verification failed for user ${userId}:`, error);
        throw new InternalServerErrorException(
          error.message || 'Payment verification failed'
        );
      }
    }
  
    private async createSubscriptionAfterPayment(userId: string, paymentReference: string, amount?: number) {
      try {
        // Check if subscription already exists for this payment reference
        const existingSubscriptions = await this.subscriptionsService.getUserSubscriptions(userId);
        const existingWithPaymentRef = existingSubscriptions.find(
          sub => sub.payment_reference === paymentReference
        );
  
        if (existingWithPaymentRef) {
          this.logger.log(`Subscription already exists for payment reference ${paymentReference}`);
          return existingWithPaymentRef;
        }
  
        // Create new subscription
        const subscription = await this.subscriptionsService.createSubscription(userId, {
          subscription_type: SubscriptionType.BASIC,
          duration_months: 1,
          payment_reference: paymentReference,
          amount_paid: amount || 129,
          currency: 'ZMW',
        });
  
        this.logger.log(`Subscription created successfully for user ${userId}, payment reference: ${paymentReference}`);
        return subscription;
      } catch (error: any) {
        this.logger.error(`Failed to create subscription after payment for user ${userId}:`, error);
        // Don't throw here - payment was successful, subscription creation is secondary
        // Could implement retry logic or manual intervention
      }
    }
  
    private wasCreatedFromPayment(subscription: any, paymentReference: string): boolean {
      return subscription.payment_reference === paymentReference;
    }
  }
  