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
import { InitiatePromotionDto, PaymentMethod } from './dto/initiate-promotion.dto';
import { PaymentProvider } from '../payments/enums/payment-provider.enums';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { addDays } from 'date-fns';

const PROMOTION_PLANS = {
  '7days': { durationDays: 7, price: 5.0, currency: 'ZMW' },
  '14days': { durationDays: 14, price: 9.0, currency: 'ZMW' },
  '1month': { durationDays: 30, price: 15.0, currency: 'ZMW' },
};

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);
  private readonly currentProvider: PaymentProvider;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly lencoService: LencoService,
    private readonly configService: ConfigService,
  ) {
    this.currentProvider = this.configService.get<PaymentProvider>(
      'PAYMENT_PROVIDER',
      PaymentProvider.LENCO,
    );
    this.logger.log(
      `PromotionsService initialized with provider: ${this.currentProvider}.`,
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
    requiresOtp?: boolean;
  }> {
    const { propertyId, planId, mobileMoneyNumber } = dto;
    const planDetails = PROMOTION_PLANS[planId];
    const operator = dto.operator || this.guessOperator(mobileMoneyNumber);

    if (this.currentProvider !== PaymentProvider.LENCO) {
      throw new BadRequestException('Lenco payment provider is required.');
    }
    if (dto.paymentMethod === PaymentMethod.CARD) {
        throw new BadRequestException('Card payments via Lenco are not directly supported for promotions yet.');
    }

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

    try {
      const lencoResponse =
        await this.lencoService.initiateMobileMoneyCollection({
          reference: paymentReference,
          amount: planDetails.price,
          phone: mobileMoneyNumber,
          operator: operator,
          country: 'zm',
        });

      const currentLencoStatus = lencoResponse.status.toLowerCase();
      const lencoReference = lencoResponse.lencoReference;

      await this.updatePromotionStatus(
        paymentReference,
        currentLencoStatus,
        lencoReference,
      );
      this.logger.log(
        `Lenco promotion initiation for ref ${paymentReference}: status ${currentLencoStatus}, Lenco Ref: ${lencoReference}`,
      );

      return {
        provider: PaymentProvider.LENCO,
        status: currentLencoStatus,
        message: `Lenco payment initiated. Status: ${currentLencoStatus}`,
        paymentReference: paymentReference,
        lencoReference: lencoReference,
        requiresOtp: currentLencoStatus === 'otp-required',
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to initiate Lenco promotion for ref ${paymentReference}: ${error.message}`,
        error.stack,
      );
      await this.updatePromotionStatus(paymentReference, 'failed', null);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to communicate with Lenco.',
      );
    }
  }

  async submitOtpForPromotion(
    paymentReference: string,
    otp: string,
  ): Promise<any> {
    if (this.currentProvider !== PaymentProvider.LENCO) {
      throw new BadRequestException('Lenco provider is required for OTP submission.');
    }
    this.logger.log(
      `Submitting OTP for Lenco promotion: ref ${paymentReference}`,
    );
    try {
      await this.lencoService.submitOtp(paymentReference, otp);
      this.logger.log(
        `OTP submitted for Lenco promotion ref ${paymentReference}. Verifying final status.`,
      );

      const verificationResult = await this.lencoService.verifyPayment(
        paymentReference,
      );
      if (!verificationResult) {
        throw new BadRequestException(
          'Failed to verify Lenco promotion status after OTP submission.',
        );
      }

      const currentLencoStatus = verificationResult.status.toLowerCase();
      await this.updatePromotionStatus(
        paymentReference,
        currentLencoStatus,
        verificationResult.lencoReference,
      );

      if (currentLencoStatus === 'successful') {
        await this.activatePromotionDates(paymentReference);
      }

      this.logger.log(
        `Lenco promotion status after OTP for ref ${paymentReference}: ${currentLencoStatus}`,
      );
      return {
        status: currentLencoStatus,
        message: `Lenco promotion status after OTP: ${currentLencoStatus}`,
        lencoReference: verificationResult.lencoReference,
        amount: verificationResult.amount,
      };
    } catch (error: any) {
      this.logger.error(
        `Lenco OTP submission/verification for promotion ref ${paymentReference} failed:`,
        error,
      );
      await this.updatePromotionStatus(paymentReference, 'failed', null);
      throw new InternalServerErrorException(
        error.message || 'Lenco OTP processing for promotion failed',
      );
    }
  }

  private async activatePromotionDates(paymentReference: string) {
    const { data: promotionToActivate, error: fetchError } =
      await this.supabase
        .from('promotions')
        .select('id, plan_duration_days, property_id')
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
    
    const { error: propertyUpdateError } = await this.supabase
      .from('properties')
      .update({ is_promoted: true, promoted_until: expiresAt.toISOString() })
      .eq('id', promotionToActivate.property_id);

    if (propertyUpdateError) {
        this.logger.error(`Failed to mark property ${promotionToActivate.property_id} as promoted: ${propertyUpdateError.message}`);
    }


    this.logger.log(
      `Promotion ${
        promotionToActivate.id
      } (ref ${paymentReference}) successfully activated. Expires: ${expiresAt.toISOString()}. Property ${promotionToActivate.property_id} marked as promoted.`,
    );
  }

  async verifyAndActivatePromotion(paymentReference: string): Promise<{
    status: string;
    message: string;
    lencoReference?: string | null;
  }> {
    this.logger.log(
      `Verifying promotion payment status for ref: ${paymentReference}`,
    );

    const { data: promotion, error: findError } = await this.supabase
      .from('promotions')
      .select('id, payment_status, lenco_reference')
      .eq('payment_reference', paymentReference)
      .maybeSingle();

    if (findError) {
      this.logger.error(
        `Verify: Error finding promotion for ref ${paymentReference}: ${findError.message}`,
      );
      throw new InternalServerErrorException('Database error fetching promotion.');
    }
    if (!promotion) {
      throw new NotFoundException(
        `Promotion not found for reference ${paymentReference}.`,
      );
    }

    if (promotion.payment_status === 'successful') {
      return {
        status: 'successful',
        message: 'Promotion is already active.',
        lencoReference: promotion.lenco_reference,
      };
    }
    
    if (this.currentProvider !== PaymentProvider.LENCO) {
        throw new BadRequestException('Lenco provider is required for this operation.');
    }

    const lencoVerification = await this.lencoService.verifyPayment(
      paymentReference,
    );

    if (!lencoVerification) {
      this.logger.warn(
        `Verify: Lenco verification failed for ref ${paymentReference}`,
      );
      await this.updatePromotionStatus(paymentReference, 'failed', promotion.lenco_reference);
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
        message: 'Promotion activated successfully via verification.',
        lencoReference: lencoApiReference,
      };
    } else {
      return {
        status: lencoStatus,
        message: `Lenco payment status: ${lencoStatus}`,
        lencoReference: lencoApiReference,
      };
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

    if (this.currentProvider === PaymentProvider.LENCO) {
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

  async handleLencoWebhook(payload: any): Promise<void> {
    this.logger.log('Received Lenco webhook for promotion');
    this.logger.debug(`Webhook payload: ${JSON.stringify(payload)}`);

    const eventType = payload.event?.toLowerCase();
    const data = payload.data;

    if (!data || !data.reference || !data.status || !eventType) {
      this.logger.warn(
        'Lenco promotion webhook missing critical data: reference, status, or event type.',
      );
      return;
    }

    const paymentReference = data.reference;
    const lencoApiReference = data.lencoReference;
    const statusFromWebhook = data.status?.toLowerCase();

    if (!paymentReference.startsWith('PROMO-')) {
        this.logger.log(`Lenco webhook for ref ${paymentReference} is not a promotion. Ignoring.`);
        return;
    }
    
    this.logger.log(
      `Processing Lenco webhook event: ${eventType} for promotion_ref: ${paymentReference} with Lenco status: ${statusFromWebhook}`,
    );

    const { data: promotion, error: findError } = await this.supabase
      .from('promotions')
      .select('id, payment_status')
      .eq('payment_reference', paymentReference)
      .maybeSingle();

    if (findError) {
      this.logger.error(
        `Webhook: Error finding promotion for ref ${paymentReference}: ${findError.message}`,
      );
      return;
    }
    if (!promotion) {
      this.logger.warn(
        `Webhook: Promotion not found for ref ${paymentReference}. Ignoring event.`,
      );
      return;
    }

    if (promotion.payment_status === 'successful' && statusFromWebhook === 'successful') {
      this.logger.log(
        `Webhook: Promotion ref ${paymentReference} already successful. Ignoring redundant event.`,
      );
      return;
    }

    let internalStatusToSet = statusFromWebhook;
    if (eventType.includes('collection.successful') || eventType.includes('collection.settled')) {
        internalStatusToSet = 'successful';
    } else if (eventType.includes('collection.failed')) {
        internalStatusToSet = 'failed';
    }


    await this.updatePromotionStatus(
      paymentReference,
      internalStatusToSet,
      lencoApiReference,
    );

    if (internalStatusToSet === 'successful') {
       try {
          await this.activatePromotionDates(paymentReference);
        } catch (error: any) {
          this.logger.error(
            `Webhook: Error during date activation for promotion ref ${paymentReference}: ${error.message}`,
            error.stack,
          );
        }
    }
  }
  
  async handleZynleWebhook(payload: any): Promise<void> {
    this.logger.log('Zynle webhook received, but Lenco is the active provider for promotions. Ignoring.');
    return;
  }
}