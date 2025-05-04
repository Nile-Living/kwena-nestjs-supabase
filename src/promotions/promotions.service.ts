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
import { InitiatePromotionDto } from './dto/initiate-promotion.dto';
import { ConfigService } from '@nestjs/config';
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
  private readonly isSandbox: boolean; // Added flag

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly lencoService: LencoService,
    private readonly configService: ConfigService,
  ) {
    // Determine if sandbox based on URL during initialization
    const baseUrl = this.configService.get<string>('LENCO_API_BASE_URL', '');
    this.isSandbox = baseUrl.includes('sandbox');
    this.logger.log(`Running in ${this.isSandbox ? 'Sandbox' : 'Live'} mode.`);
  }

  private guessOperator(phone: string): string {
    if (phone.startsWith('097') || phone.startsWith('077')) return 'airtel';
    if (phone.startsWith('096') || phone.startsWith('076')) return 'mtn';
    if (phone.startsWith('095') || phone.startsWith('075')) return 'zamtel';
    return 'airtel';
  }

  async initiatePromotion(dto: InitiatePromotionDto): Promise<{
    status: string;
    message: string;
    paymentReference: string;
  }> {
    const { propertyId, planId, mobileMoneyNumber } = dto;
    const planDetails = PROMOTION_PLANS[planId];
    const operator = dto.operator || this.guessOperator(mobileMoneyNumber);

    if (!planDetails) {
      throw new BadRequestException('Invalid promotion plan selected.');
    }

    // --- Property and Existing Promotion Checks (Keep as is) ---
    const { data: property, error: propError } = await this.supabase
      .from('properties')
      .select('id')
      .eq('id', propertyId)
      .maybeSingle();

    if (propError) {
      this.logger.error(`Error checking property ${propertyId}: ${propError.message}`);
      throw new InternalServerErrorException('Failed to validate property.');
    }
    if (!property) {
      throw new NotFoundException(`Property with ID ${propertyId} not found.`);
    }

    const { data: existingPromotion, error: existingError } = await this.supabase
        .from('promotions')
        .select('id, payment_status, promotion_expires_at')
        .eq('property_id', propertyId)
        .or(`payment_status.eq.successful,promotion_expires_at.gt.${new Date().toISOString()},payment_status.eq.pending,payment_status.eq.otp-required,payment_status.eq.pay-offline`)
        .maybeSingle();

    if (existingError) {
      this.logger.error(`Error checking existing promotions for property ${propertyId}: ${existingError.message}`);
      throw new InternalServerErrorException('Failed to check for existing promotions.');
    }

    if (existingPromotion) {
       if (existingPromotion.payment_status === 'successful') {
         throw new ConflictException(`Property ${propertyId} already has an active promotion expiring at ${existingPromotion.promotion_expires_at}.`);
       } else {
         throw new ConflictException(`Property ${propertyId} has a promotion currently in '${existingPromotion.payment_status}' status. Please complete or wait for the existing payment.`);
       }
    }
    // --- End Checks ---

    const paymentReference = `PROMO-${uuidv4()}`;
    const promotionData = {
      property_id: propertyId,
      plan_id: planId,
      plan_duration_days: planDetails.durationDays,
      amount_paid: planDetails.price,
      currency: planDetails.currency,
      payment_provider: 'lenco',
      payment_reference: paymentReference,
      payment_status: 'pending',
    };

    const { error: insertError } = await this.supabase
      .from('promotions')
      .insert(promotionData);

    if (insertError) {
       if (insertError.code === '23505') {
         throw new ConflictException('A promotion record for this property already exists.');
       }
       this.logger.error(`Error inserting promotion record for ref ${paymentReference}: ${insertError.message}`);
       throw new InternalServerErrorException('Failed to initiate promotion record.');
    }

    this.logger.log(`Promotion initiated for property ${propertyId}, plan ${planId}, ref ${paymentReference}`);

    let currentLencoStatus = 'pending';
    let lencoReference: string | null = null;

    try {
      const lencoResponse = await this.lencoService.initiateMobileMoneyCollection({
          reference: paymentReference,
          amount: planDetails.price,
          phone: mobileMoneyNumber,
          operator: operator,
          country: 'zm',
        });
      currentLencoStatus = lencoResponse.status;
      lencoReference = lencoResponse.lencoReference;
      await this.updatePromotionStatus(paymentReference, currentLencoStatus, lencoReference);
      this.logger.log(`Lenco initiation status for ref ${paymentReference}: ${currentLencoStatus}`);
    } catch (error) {
      this.logger.error(`Failed to initiate Lenco collection for ref ${paymentReference}: ${error.message}`);
      await this.updatePromotionStatus(paymentReference, 'failed', null);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to communicate with payment provider.');
    }

    // --- Handle OTP for Sandbox ---
    if (currentLencoStatus === 'otp-required' && this.isSandbox) {
      this.logger.log(`Sandbox environment detected, submitting OTP 000000 for ref ${paymentReference}`);
      try {
        const otpResponse = await this.lencoService.submitOtp(paymentReference, '000000');
        this.logger.log(`Sandbox OTP submitted for ref ${paymentReference}, new status: ${otpResponse.status}`);
        await this.updatePromotionStatus(paymentReference, otpResponse.status, otpResponse.lencoReference || lencoReference);
        currentLencoStatus = otpResponse.status; // Update status before polling
        lencoReference = otpResponse.lencoReference || lencoReference;
      } catch (otpError) {
        this.logger.error(`Failed to submit sandbox OTP for ref ${paymentReference}: ${otpError.message}`);
      }
    }
    // --- End Handle OTP ---

    // --- Start Polling Logic ---
    let finalLencoStatus = currentLencoStatus; // Use the status after potential OTP submit
    let finalLencoReference = lencoReference;
    let attempts = 0;
    const statusesRequiringPolling = ['pending', 'pay-offline']; // Removed otp-required as it's handled above

    if (statusesRequiringPolling.includes(finalLencoStatus)) {
      this.logger.log(`Status ${finalLencoStatus} requires polling for ref ${paymentReference}.`);

      while (attempts < MAX_POLLING_ATTEMPTS) {
        attempts++;
        this.logger.log(`Polling attempt ${attempts}/${MAX_POLLING_ATTEMPTS} for ref ${paymentReference}...`);
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));

        const verificationResult = await this.lencoService.verifyPayment(paymentReference);

        if (verificationResult) {
          finalLencoStatus = verificationResult.status;
          finalLencoReference = verificationResult.lencoReference;
          this.logger.log(`Polling result for ref ${paymentReference}: Status ${finalLencoStatus}`);
          await this.updatePromotionStatus(paymentReference, finalLencoStatus, finalLencoReference);

          // *** SANDBOX SUCCESS SIMULATION ***
          if (finalLencoStatus === 'pay-offline' && this.isSandbox) {
            this.logger.log(`Sandbox: Treating 'pay-offline' as 'successful' for ref ${paymentReference}.`);
            finalLencoStatus = 'successful'; // Override status for sandbox testing
            break; // Exit polling loop after simulated success
          }
          // *** END SANDBOX SIMULATION ***

          // Exit loop if final status reached (successful or failed)
          if (finalLencoStatus === 'successful' || finalLencoStatus === 'failed') {
            break;
          }
        } else {
          this.logger.warn(`Polling attempt ${attempts} failed to verify ref ${paymentReference}.`);
        }
      } // End while loop

      // Check if polling timed out while still in a pending state
      if (statusesRequiringPolling.includes(finalLencoStatus)) {
        this.logger.warn(`Polling timed out for ref ${paymentReference} after ${attempts} attempts. Final status: ${finalLencoStatus}`);
        // Optionally update status to 'timed_out'
        // await this.updatePromotionStatus(paymentReference, 'timed_out', finalLencoReference);
        // finalLencoStatus = 'timed_out';
      }
    }
    // --- End Polling Logic ---

    // --- Activate Promotion if Successful (includes sandbox simulation) ---
    if (finalLencoStatus === 'successful') {
      try {
        const { data: promotionDetails, error: fetchError } = await this.supabase
          .from('promotions')
          .select('plan_duration_days') // Fetch duration again just in case
          .eq('payment_reference', paymentReference)
          .single();

        if (fetchError || !promotionDetails) {
           throw new Error('Could not fetch promotion details for activation.');
        }

        const now = new Date();
        const expiresAt = addDays(now, promotionDetails.plan_duration_days);

        const { error: updateTimeError } = await this.supabase
          .from('promotions')
          .update({
            promotion_starts_at: now.toISOString(),
            promotion_expires_at: expiresAt.toISOString(),
            payment_status: 'successful', // Ensure status is set correctly
            lenco_reference: finalLencoReference,
          })
          .eq('payment_reference', paymentReference);

        if (updateTimeError) {
          this.logger.error(`Error setting start/expiry for ref ${paymentReference}: ${updateTimeError.message}`);
          throw new InternalServerErrorException('Failed to activate promotion timing after successful payment.');
        }
        this.logger.log(`Promotion ref ${paymentReference} successfully activated. Expires: ${expiresAt.toISOString()}`);
        return {
          status: 'success',
          message: 'Promotion activated successfully!',
          paymentReference: paymentReference,
        };
      } catch (activationError) {
        this.logger.error(`Activation failed for successful payment ref ${paymentReference}: ${activationError.message}`);
        return {
          status: 'success_activation_failed',
          message: 'Payment successful, but failed to update promotion times. Please contact support.',
          paymentReference: paymentReference,
        };
      }
    } else {
      // Return final non-successful status
      this.logger.warn(`Promotion ref ${paymentReference} finished with non-successful status: ${finalLencoStatus}`);
      return {
        status: finalLencoStatus,
        message: `Payment final status: ${finalLencoStatus}.`,
        paymentReference: paymentReference,
      };
    }
  }

  // --- verifyAndActivatePromotion (Keep as is, useful for webhooks/manual checks) ---
  async verifyAndActivatePromotion(
    paymentReference: string,
  ): Promise<{ status: string; message: string }> {
     // ... existing implementation ...
     // Note: This method does NOT include the sandbox 'pay-offline' simulation
     // It relies on the actual status reported by Lenco during verification.
     // It's primarily useful if called *after* the real payment flow completes (e.g., via webhook).
     this.logger.log(`Verifying and activating promotion via dedicated endpoint for ref: ${paymentReference}`);

     const { data: promotion, error: findError } = await this.supabase
       .from('promotions')
       .select('*')
       .eq('payment_reference', paymentReference)
       .single();

     if (findError || !promotion) {
       this.logger.error(`Verify Endpoint: Error finding promotion record for ref ${paymentReference}: ${findError?.message}`);
       throw new NotFoundException(`Promotion record not found for reference ${paymentReference}.`);
     }

     if (promotion.payment_status === 'successful') {
       this.logger.warn(`Verify Endpoint: Promotion ref ${paymentReference} already marked as successful.`);
       return { status: 'success', message: 'Promotion already active.' };
     }

     const lencoVerification = await this.lencoService.verifyPayment(paymentReference);

     if (!lencoVerification) {
       this.logger.warn(`Verify Endpoint: Lenco verification failed or returned null for ref ${paymentReference}.`);
       await this.updatePromotionStatus(paymentReference, 'failed', null);
       throw new HttpException('Payment verification failed with Lenco.', HttpStatus.BAD_GATEWAY);
     }

     const lencoStatus = lencoVerification.status;
     const lencoReference = lencoVerification.lencoReference;

     this.logger.log(`Verify Endpoint: Lenco verification status for ref ${paymentReference}: ${lencoStatus}`);

     await this.updatePromotionStatus(paymentReference, lencoStatus, lencoReference);

     if (lencoStatus === 'successful') {
       const now = new Date();
       const expiresAt = addDays(now, promotion.plan_duration_days);

       const { error: updateTimeError } = await this.supabase
         .from('promotions')
         .update({
           promotion_starts_at: now.toISOString(),
           promotion_expires_at: expiresAt.toISOString(),
         })
         .eq('payment_reference', paymentReference);

       if (updateTimeError) {
         this.logger.error(`Verify Endpoint: Error setting start/expiry for ref ${paymentReference}: ${updateTimeError.message}`);
         throw new InternalServerErrorException('Failed to activate promotion timing.');
       }

       this.logger.log(`Verify Endpoint: Promotion ref ${paymentReference} successfully activated. Expires: ${expiresAt.toISOString()}`);
       return { status: 'success', message: 'Promotion activated successfully.' };
     } else {
       this.logger.warn(`Verify Endpoint: Lenco payment status for ref ${paymentReference} is not 'successful': ${lencoStatus}`);
       return { status: lencoStatus, message: `Payment status: ${lencoStatus}` };
     }
  }


  // --- updatePromotionStatus (Keep as is) ---
  private async updatePromotionStatus(
    paymentReference: string,
    status: string,
    lencoReference: string | null,
  ): Promise<void> {
    // ... existing implementation ...
     const { error } = await this.supabase
       .from('promotions')
       .update({
         payment_status: status,
         lenco_reference: lencoReference,
         updated_at: new Date().toISOString(),
       })
       .eq('payment_reference', paymentReference);

     if (error) {
       this.logger.error(`Failed to update promotion status to '${status}' for ref ${paymentReference}: ${error.message}`);
     }
  }

  // --- handleLencoWebhook (Keep as is, but remember to implement signature validation) ---
  async handleLencoWebhook(payload: any): Promise<void> {
    // ... existing implementation ...
    this.logger.log('Received Lenco webhook');
    this.logger.debug(`Webhook payload: ${JSON.stringify(payload)}`);

    // --- TODO: Validate webhook signature ---

    const eventType = payload.event;
    const data = payload.data;
    const reference = data?.reference;
    const lencoReference = data?.lencoReference;
    const status = data?.status;

    if (!reference || !status || !eventType) {
      this.logger.warn('Webhook payload missing reference, status, or event type');
      return;
    }

    this.logger.log(`Processing webhook event: ${eventType} for reference: ${reference} with status: ${status}`);

    const { data: promotion, error: findError } = await this.supabase
      .from('promotions')
      .select('id, payment_status, plan_duration_days')
      .eq('payment_reference', reference)
      .single();

    if (findError || !promotion) {
      this.logger.error(`Webhook: Promotion record not found for reference ${reference}: ${findError?.message}`);
      return;
    }

    if (promotion.payment_status === 'successful') {
      this.logger.log(`Webhook: Promotion ref ${reference} already successful. Ignoring event ${eventType}.`);
      return;
    }

    let internalStatus = status;
    if (eventType === 'collection.successful') {
      internalStatus = 'successful';
    } else if (eventType === 'collection.failed') {
      internalStatus = 'failed';
    }

    await this.updatePromotionStatus(reference, internalStatus, lencoReference);

    if (internalStatus === 'successful') {
      try {
        const now = new Date();
        const expiresAt = addDays(now, promotion.plan_duration_days);

        const { error: updateTimeError } = await this.supabase
          .from('promotions')
          .update({
            promotion_starts_at: now.toISOString(),
            promotion_expires_at: expiresAt.toISOString(),
          })
          .eq('payment_reference', reference);

        if (updateTimeError) {
          this.logger.error(`Webhook: Error setting start/expiry for ref ${reference}: ${updateTimeError.message}`);
        } else {
          this.logger.log(`Webhook: Promotion ref ${reference} activated via webhook. Expires: ${expiresAt.toISOString()}`);
        }
      } catch (error) {
        this.logger.error(`Webhook: Error activating promotion timing for ref ${reference} after successful event: ${error.message}`);
      }
    }
  }
}
