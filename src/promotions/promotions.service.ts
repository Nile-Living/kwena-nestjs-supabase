// src/promotions/promotions.service.ts
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
import { LencoService } from '../lenco/lenco.service';
import { ZynleService } from '../zynle/zynle.service';
import { InitiatePromotionDto, PaymentMethod } from './dto/initiate-promotion.dto';
import { PaymentProvider } from '../payments/enums/payment-provider.enums';
import { ConfigService } from '@nestjs/config';
import { ZynleCallbackResponse } from '../zynle/interfaces/zynle.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { addDays } from 'date-fns';

const PROMOTION_PLANS = {
  '7days': { durationDays: 7, price: 50.0, currency: 'ZMW' },
  '14days': { durationDays: 14, price: 90.0, currency: 'ZMW' },
  '1month': { durationDays: 30, price: 150.0, currency: 'ZMW' },
};

const POLLING_INTERVAL_MS = 3000;
const MAX_POLLING_ATTEMPTS = 5;

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);
  private readonly currentProvider: PaymentProvider;
  private readonly isSandbox: boolean;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly lencoService: LencoService,
    private readonly zynleService: ZynleService,
    private readonly configService: ConfigService,
  ) {
    this.currentProvider = this.configService.get<PaymentProvider>(
      'PAYMENT_PROVIDER',
      PaymentProvider.ZYNLE,
    );
    
    const baseUrl = this.configService.get<string>('LENCO_API_BASE_URL', '');
    this.isSandbox = baseUrl.includes('sandbox');
    
    this.logger.log(
      `PromotionsService initialized with provider: ${this.currentProvider}. Running in ${
        this.isSandbox ? 'Sandbox' : 'Live'
      } mode.`,
    );
  }

  private guessOperator(phone: string): string {
    if (phone.startsWith('097') || phone.startsWith('077')) return 'airtel';
    if (phone.startsWith('096') || phone.startsWith('076')) return 'mtn';
    if (phone.startsWith('095') || phone.startsWith('075')) return 'zamtel';
    this.logger.warn(
      `Could not determine operator for ${phone}, defaulting to 'mtn'.`,
    );
    return 'mtn';
  }

  async initiatePromotion(dto: InitiatePromotionDto): Promise<{
    provider: string;
    status: string;
    message: string;
    paymentReference: string;
    lencoReference?: string | null;
    transaction_id?: string;
    redirect_url?: string;
  }> {
    const { propertyId, planId, mobileMoneyNumber } = dto;
    const planDetails = PROMOTION_PLANS[planId];
    const operator = dto.operator || this.guessOperator(mobileMoneyNumber);
    const paymentMethod = dto.paymentMethod || PaymentMethod.MOMO;

    if (!planDetails) {
      throw new BadRequestException('Invalid promotion plan selected.');
    }

    const { data: property, error: propError } = await this.supabase
      .from('properties')
      .select('id')
      .eq('id', propertyId)
      .maybeSingle();

    if (propError) {
      this.logger.error(
        `Error checking property ${propertyId}: ${propError.message}`,
      );
      throw new InternalServerErrorException('Failed to validate property.');
    }
    if (!property) {
      throw new NotFoundException(`Property with ID ${propertyId} not found.`);
    }

    const { data: existingPromotion, error: existingError } =
      await this.supabase
        .from('promotions')
        .select('id, payment_status, promotion_expires_at')
        .eq('property_id', propertyId)
        .or(
          `and(payment_status.eq.successful,promotion_expires_at.gt.${new Date().toISOString()}),payment_status.in.("pending","otp-required","pay-offline")`,
        )
        .maybeSingle();

    if (existingError) {
      this.logger.error(
        `Error checking existing promotions for property ${propertyId}: ${existingError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to check for existing promotions.',
      );
    }

    if (existingPromotion) {
      if (
        existingPromotion.payment_status === 'successful' &&
        new Date(existingPromotion.promotion_expires_at) > new Date()
      ) {
        throw new ConflictException(
          `Property ${propertyId} already has an active promotion expiring at ${new Date(
            existingPromotion.promotion_expires_at,
          ).toLocaleDateString()}.`,
        );
      } else if (
        ['pending', 'otp-required', 'pay-offline'].includes(
          existingPromotion.payment_status,
        )
      ) {
        throw new ConflictException(
          `Property ${propertyId} has a promotion currently in '${existingPromotion.payment_status}' status. Please complete or wait for the existing payment process.`,
        );
      }
    }

    const paymentReference = `PROMO-${uuidv4()}`;
    const promotionData = {
      property_id: propertyId,
      plan_id: planId,
      plan_duration_days: planDetails.durationDays,
      amount_paid: planDetails.price,
      currency: planDetails.currency,
      payment_provider: this.currentProvider.toLowerCase(),
      payment_reference: paymentReference,
      payment_status: 'pending',
    };

    const { data: insertedPromotion, error: insertError } = await this.supabase
      .from('promotions')
      .insert(promotionData)
      .select()
      .single();

    if (insertError || !insertedPromotion) {
      if (insertError && insertError.code === '23505') {
        this.logger.error(
          `Conflict inserting promotion record for ref ${paymentReference}. Error: ${insertError.message}`,
        );
        throw new ConflictException(
          'Failed to create promotion record due to a conflict. Please try again.',
        );
      }
      this.logger.error(
        `Error inserting promotion record for ref ${paymentReference}: ${
          insertError?.message || 'No data returned from insert'
        }`,
      );
      throw new InternalServerErrorException(
        'Failed to initiate promotion record.',
      );
    }

    this.logger.log(
      `Promotion record ${insertedPromotion.id} initiated for property ${propertyId}, plan ${planId}, ref ${paymentReference}`,
    );

    if (this.currentProvider === PaymentProvider.ZYNLE) {
      return this.initiateZynlePromotion(paymentReference, planDetails, mobileMoneyNumber, operator, paymentMethod, dto.cardDetails);
    } else {
      return this.initiateLencoPromotion(paymentReference, planDetails, mobileMoneyNumber, operator);
    }
  }

  private async initiateZynlePromotion(
    paymentReference: string,
    planDetails: any,
    mobileMoneyNumber: string,
    operator: string,
    paymentMethod: PaymentMethod,
    cardDetails?: any,
  ) {
    try {
      const zynleResponse = await this.zynleService.initiateMobileMoneyCollection({
        amount: planDetails.price,
        reference: paymentReference,
        phone: mobileMoneyNumber,
        operator: operator,
        method: paymentMethod,
        email: cardDetails?.email,
        first_name: 'User',
        last_name: 'Name',
        address: 'N/A',
        city: 'Lusaka',
        state: 'Lusaka',
        zip_code: '10101',
        country: 'ZMB',
        description: 'Property Promotion',
      });

      const status = this.mapZynleStatusToInternal(zynleResponse.status);
      
      await this.updatePromotionStatus(
        paymentReference,
        status,
        zynleResponse.transaction_id,
      );

      this.logger.log(
        `Zynle promotion initiation status for ref ${paymentReference}: ${status}`,
      );

      if (this.zynleService.isPaymentSuccessful('100')) {
        await this.activatePromotionDates(paymentReference);
        return {
          provider: PaymentProvider.ZYNLE,
          status: 'successful',
          message: 'Promotion activated successfully!',
          paymentReference: paymentReference,
          transaction_id: zynleResponse.transaction_id,
        };
      }

      return {
        provider: PaymentProvider.ZYNLE,
        status: status,
        message: zynleResponse.message,
        paymentReference: paymentReference,
        transaction_id: zynleResponse.transaction_id,
        redirect_url: zynleResponse.redirect_url,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to initiate Zynle promotion for ref ${paymentReference}: ${error.message}`,
        error.stack,
      );
      await this.updatePromotionStatus(paymentReference, 'failed', null);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to communicate with payment provider.',
      );
    }
  }

  private async initiateLencoPromotion(
    paymentReference: string,
    planDetails: any,
    mobileMoneyNumber: string,
    operator: string,
  ) {
    let currentLencoStatus = 'pending';
    let lencoReference: string | null = null;

    try {
      const lencoResponse =
        await this.lencoService.initiateMobileMoneyCollection({
          reference: paymentReference,
          amount: planDetails.price,
          phone: mobileMoneyNumber,
          operator: operator,
          country: 'zm',
        });
      currentLencoStatus = lencoResponse.status.toLowerCase();
      lencoReference = lencoResponse.lencoReference;
      await this.updatePromotionStatus(
        paymentReference,
        currentLencoStatus,
        lencoReference,
      );
      this.logger.log(
        `Lenco initiation status for ref ${paymentReference}: ${currentLencoStatus}, Lenco Ref: ${lencoReference}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to initiate Lenco promotion for ref ${paymentReference}: ${error.message}`,
        error.stack,
      );
      await this.updatePromotionStatus(paymentReference, 'failed', null);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to communicate with payment provider.',
      );
    }

    if (currentLencoStatus === 'otp-required' && this.isSandbox) {
      this.logger.log(
        `Sandbox: OTP required for ref ${paymentReference}. Submitting '000000'.`,
      );
      try {
        const otpResponse = await this.lencoService.submitOtp(
          paymentReference,
          '000000',
        );
        currentLencoStatus = otpResponse.status.toLowerCase();
        lencoReference = otpResponse.lencoReference || lencoReference;
        await this.updatePromotionStatus(
          paymentReference,
          currentLencoStatus,
          lencoReference,
        );
        this.logger.log(
          `Sandbox OTP submitted for ref ${paymentReference}, new status: ${currentLencoStatus}`,
        );
      } catch (otpError: any) {
        this.logger.error(
          `Failed to submit sandbox OTP for ref ${paymentReference}: ${otpError.message}`,
        );
      }
    }

    let finalLencoStatus = currentLencoStatus;
    let finalLencoReference = lencoReference;
    let attempts = 0;
    const statusesRequiringPolling = ['pending', 'pay-offline'];

    if (statusesRequiringPolling.includes(finalLencoStatus)) {
      this.logger.log(
        `Status '${finalLencoStatus}' requires polling for ref ${paymentReference}.`,
      );

      while (attempts < MAX_POLLING_ATTEMPTS) {
        attempts++;
        this.logger.log(
          `Polling attempt ${attempts}/${MAX_POLLING_ATTEMPTS} for ref ${paymentReference}...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, POLLING_INTERVAL_MS),
        );

        const verificationResult =
          await this.lencoService.verifyPayment(paymentReference);

        if (verificationResult) {
          finalLencoStatus = verificationResult.status.toLowerCase();
          finalLencoReference = verificationResult.lencoReference;
          this.logger.log(
            `Polling result for ref ${paymentReference}: Status ${finalLencoStatus}`,
          );
          await this.updatePromotionStatus(
            paymentReference,
            finalLencoStatus,
            finalLencoReference,
          );

          if (finalLencoStatus === 'pay-offline' && this.isSandbox) {
            this.logger.log(
              `Sandbox: Treating 'pay-offline' as 'successful' for ref ${paymentReference}.`,
            );
            finalLencoStatus = 'successful';
            break;
          }

          if (
            finalLencoStatus === 'successful' ||
            finalLencoStatus === 'failed'
          ) {
            break;
          }
        } else {
          this.logger.warn(
            `Polling attempt ${attempts} failed to verify ref ${paymentReference}.`,
          );
        }
      }
    }

    if (finalLencoStatus === 'successful') {
      try {
        await this.activatePromotionDates(paymentReference);
        return {
          provider: PaymentProvider.LENCO,
          status: 'successful',
          message: 'Promotion activated successfully!',
          paymentReference: paymentReference,
          lencoReference: finalLencoReference,
        };
      } catch (activationError: any) {
        this.logger.error(
          `Activation failed for successful payment (ref ${paymentReference}): ${activationError.message}`,
          activationError.stack,
        );
        return {
          provider: PaymentProvider.LENCO,
          status: 'success_activation_failed',
          message:
            'Payment successful, but an error occurred during final activation. Please contact support.',
          paymentReference: paymentReference,
          lencoReference: finalLencoReference,
        };
      }
    } else {
      this.logger.warn(
        `Promotion (ref ${paymentReference}) finished with non-successful status: ${finalLencoStatus}`,
      );
      return {
        provider: PaymentProvider.LENCO,
        status: finalLencoStatus,
        message: `Payment process ended with status: ${finalLencoStatus}.`,
        paymentReference: paymentReference,
        lencoReference: finalLencoReference,
      };
    }
  }

  private mapZynleStatusToInternal(zynleStatus: string): string {
    switch (zynleStatus.toLowerCase()) {
      case 'initiated': return 'pending';
      case 'redirect': return 'pending';
      default: return zynleStatus.toLowerCase();
    }
  }

  private async activatePromotionDates(paymentReference: string) {
    const { data: promotionToActivate, error: fetchError } =
      await this.supabase
        .from('promotions')
        .select('id, plan_duration_days')
        .eq('payment_reference', paymentReference)
        .single();

    if (fetchError || !promotionToActivate) {
      this.logger.error(
        `Could not re-fetch promotion details for activation (ref ${paymentReference}): ${
          fetchError?.message || 'Not found'
        }`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve promotion details for activation.',
      );
    }

    const now = new Date();
    const expiresAt = addDays(now, promotionToActivate.plan_duration_days);

    const { error: updateTimeError } = await this.supabase
      .from('promotions')
      .update({
        promotion_starts_at: now.toISOString(),
        promotion_expires_at: expiresAt.toISOString(),
        payment_status: 'successful',
      })
      .eq('id', promotionToActivate.id);

    if (updateTimeError) {
      this.logger.error(
        `Error setting start/expiry for promotion ${
          promotionToActivate.id
        } (ref ${paymentReference}): ${updateTimeError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to activate promotion timing.',
      );
    }
    
    this.logger.log(
      `Promotion ${
        promotionToActivate.id
      } (ref ${paymentReference}) successfully activated. Expires: ${expiresAt.toISOString()}`,
    );
  }

  async verifyAndActivatePromotion(paymentReference: string): Promise<{
    status: string;
    message: string;
    lencoReference?: string | null;
    transaction_id?: string;
  }> {
    this.logger.log(
      `Verifying and activating promotion via dedicated endpoint for ref: ${paymentReference}`,
    );

    const { data: promotion, error: findError } = await this.supabase
      .from('promotions')
      .select('id, payment_status, plan_duration_days, lenco_reference, zynle_reference')
      .eq('payment_reference', paymentReference)
      .maybeSingle();

    if (findError) {
      this.logger.error(
        `Verify Endpoint: Error finding promotion record for ref ${paymentReference}: ${findError.message}`,
      );
      throw new InternalServerErrorException(
        'Database error while fetching promotion.',
      );
    }
    if (!promotion) {
      throw new NotFoundException(
        `Promotion record not found for reference ${paymentReference}.`,
      );
    }

    if (promotion.payment_status === 'successful') {
      this.logger.log(
        `Verify Endpoint: Promotion ref ${paymentReference} already marked as successful.`,
      );
      return {
        status: 'successful',
        message: 'Promotion is already active.',
        lencoReference: promotion.lenco_reference,
        transaction_id: promotion.zynle_reference,
      };
    }

    if (this.currentProvider === PaymentProvider.ZYNLE) {
      const zynleVerification = await this.zynleService.verifyPayment(paymentReference);

      if (!zynleVerification) {
        this.logger.warn(
          `Verify Endpoint: Zynle verification failed for ref ${paymentReference}`,
        );
        throw new HttpException(
          'Payment verification with Zynle failed or payment not found.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const zynleStatus = this.zynleService.isPaymentSuccessful(zynleVerification.response_code) ? 'successful' : 'failed';
      
      await this.updatePromotionStatus(
        paymentReference,
        zynleStatus,
        zynleVerification.reference_no,
      );

      if (zynleStatus === 'successful') {
        await this.activatePromotionDates(paymentReference);
        return {
          status: 'successful',
          message: 'Promotion activated successfully.',
          transaction_id: zynleVerification.reference_no,
        };
      } else {
        return {
          status: zynleStatus,
          message: `Payment status from Zynle: ${zynleStatus}`,
          transaction_id: zynleVerification.reference_no,
        };
      }
    } else {
      const lencoVerification = await this.lencoService.verifyPayment(paymentReference);

      if (!lencoVerification) {
        this.logger.warn(
          `Verify Endpoint: Lenco verification failed for ref ${paymentReference}`,
        );
        throw new HttpException(
          'Payment verification with Lenco failed or payment not found.',
          HttpStatus.BAD_GATEWAY,
        );
      }

      const lencoStatus = lencoVerification.status.toLowerCase();
      const lencoApiReference = lencoVerification.lencoReference;

      await this.updatePromotionStatus(
        paymentReference,
        lencoStatus,
        lencoApiReference,
      );

      if (lencoStatus === 'successful') {
        await this.activatePromotionDates(paymentReference);
        return {
          status: 'successful',
          message: 'Promotion activated successfully.',
          lencoReference: lencoApiReference,
        };
      } else {
        return {
          status: lencoStatus,
          message: `Payment status from Lenco: ${lencoStatus}`,
          lencoReference: lencoApiReference,
        };
      }
    }
  }

  private async updatePromotionStatus(
    paymentReference: string,
    status: string,
    providerReference: string | null,
  ): Promise<void> {
    const updateData: any = {
      payment_status: status.toLowerCase(),
      updated_at: new Date().toISOString(),
    };

    if (this.currentProvider === PaymentProvider.ZYNLE) {
      updateData.zynle_reference = providerReference;
    } else {
      updateData.lenco_reference = providerReference;
    }

    const { error } = await this.supabase
      .from('promotions')
      .update(updateData)
      .eq('payment_reference', paymentReference);

    if (error) {
      this.logger.error(
        `Failed to update promotion status to '${status}' for ref ${paymentReference}: ${error.message}`,
      );
    } else {
      this.logger.log(
        `Promotion status updated to '${status}' for ref ${paymentReference}. Provider Ref: ${providerReference}`,
      );
    }
  }

  async handleZynleWebhook(payload: ZynleCallbackResponse): Promise<void> {
    this.logger.log('Received Zynle webhook');
    this.logger.debug(`Webhook payload: ${JSON.stringify(payload)}`);

    const paymentReference = payload.reference_no;
    const zynleTransactionId = payload.transaction_id;
    const responseCode = payload.response_code;

    if (!paymentReference || !responseCode) {
      this.logger.warn(
        `Webhook payload missing critical fields: reference or response_code.`,
      );
      return;
    }

    this.logger.log(
      `Processing Zynle webhook for payment_reference: ${paymentReference} with response_code: ${responseCode}`,
    );

    const { data: promotion, error: findError } = await this.supabase
      .from('promotions')
      .select('id, payment_status, plan_duration_days')
      .eq('payment_reference', paymentReference)
      .maybeSingle();

    if (findError) {
      this.logger.error(
        `Webhook: Error finding promotion for payment_reference ${paymentReference}: ${findError.message}`,
      );
      return;
    }
    if (!promotion) {
      this.logger.warn(
        `Webhook: Promotion record not found for payment_reference ${paymentReference}. Ignoring event.`,
      );
      return;
    }

    if (promotion.payment_status === 'successful' && responseCode === '100') {
      this.logger.log(
        `Webhook: Promotion ref ${paymentReference} already successful. Ignoring redundant successful event.`,
      );
      return;
    }

    let internalStatusToSet = promotion.payment_status;
    if (responseCode === '100') {
      internalStatusToSet = 'successful';
    } else if (responseCode === '995') {
      internalStatusToSet = 'failed';
    } else {
      internalStatusToSet = this.mapZynleStatusToInternal(responseCode);
    }

    await this.updatePromotionStatus(
      paymentReference,
      internalStatusToSet,
      zynleTransactionId ?? null,
    );

    if (internalStatusToSet === 'successful') {
      const { data: currentPromotionState, error: fetchCurrentError } = await this.supabase
        .from('promotions')
        .select('promotion_starts_at')
        .eq('id', promotion.id)
        .single();

      if (fetchCurrentError) {
        this.logger.error(`Webhook: Error fetching current state for promotion ${promotion.id}: ${fetchCurrentError.message}`);
        return;
      }

      if (currentPromotionState && !currentPromotionState.promotion_starts_at) {
        try {
          await this.activatePromotionDates(paymentReference);
        } catch (error: any) {
          this.logger.error(
            `Webhook: Error during date activation for promotion ${promotion.id} (ref ${paymentReference}): ${error.message}`,
            error.stack,
          );
        }
      } else if (currentPromotionState && currentPromotionState.promotion_starts_at) {
        this.logger.log(`Webhook: Promotion ${promotion.id} (ref ${paymentReference}) dates already set. Skipping date update.`);
      }
    }
  }

  async handleLencoWebhook(payload: any): Promise<void> {
    this.logger.log('Received Lenco webhook');
    this.logger.debug(`Webhook payload: ${JSON.stringify(payload)}`);

    const eventType = payload.event?.toLowerCase();
    const data = payload.data;

    if (!data) {
      this.logger.warn('Webhook payload missing data object.');
      return;
    }

    const paymentReference = data.reference;
    const lencoApiReference = data.lencoReference;
    const statusFromWebhook = data.status?.toLowerCase();

    if (!paymentReference || !statusFromWebhook || !eventType) {
      this.logger.warn(
        `Webhook payload missing critical fields: reference, status, or event type.`,
      );
      return;
    }

    this.logger.log(
      `Processing webhook event: ${eventType} for payment_reference: ${paymentReference} with Lenco status: ${statusFromWebhook}`,
    );

    const { data: promotion, error: findError } = await this.supabase
      .from('promotions')
      .select('id, payment_status, plan_duration_days')
      .eq('payment_reference', paymentReference)
      .maybeSingle();

    if (findError) {
      this.logger.error(
        `Webhook: Error finding promotion for payment_reference ${paymentReference}: ${findError.message}`,
      );
      return;
    }
    if (!promotion) {
      this.logger.warn(
        `Webhook: Promotion record not found for payment_reference ${paymentReference}. Ignoring event.`,
      );
      return;
    }

    if (promotion.payment_status === 'successful' && statusFromWebhook === 'successful') {
      this.logger.log(
        `Webhook: Promotion ref ${paymentReference} already successful. Ignoring redundant successful event ${eventType}.`,
      );
      return;
    }

    let internalStatusToSet = promotion.payment_status;
    if (
      eventType.includes('successful') ||
      statusFromWebhook === 'successful'
    ) {
      internalStatusToSet = 'successful';
    } else if (eventType.includes('failed') || statusFromWebhook === 'failed') {
      internalStatusToSet = 'failed';
    } else {
      internalStatusToSet = statusFromWebhook;
    }

    await this.updatePromotionStatus(
      paymentReference,
      internalStatusToSet,
      lencoApiReference,
    );

    if (internalStatusToSet === 'successful') {
      const { data: currentPromotionState, error: fetchCurrentError } = await this.supabase
        .from('promotions')
        .select('promotion_starts_at')
        .eq('id', promotion.id)
        .single();

      if (fetchCurrentError) {
        this.logger.error(`Webhook: Error fetching current state for promotion ${promotion.id}: ${fetchCurrentError.message}`);
        return;
      }

      if (currentPromotionState && !currentPromotionState.promotion_starts_at) {
        try {
          await this.activatePromotionDates(paymentReference);
        } catch (error: any) {
          this.logger.error(
            `Webhook: Error during date activation for promotion ${promotion.id} (ref ${paymentReference}): ${error.message}`,
            error.stack,
          );
        }
      } else if (currentPromotionState && currentPromotionState.promotion_starts_at) {
        this.logger.log(`Webhook: Promotion ${promotion.id} (ref ${paymentReference}) dates already set. Skipping date update.`);
      }
    }
  }
}