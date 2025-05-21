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
  private readonly isSandbox: boolean;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly lencoService: LencoService,
    private readonly configService: ConfigService,
  ) {
    const baseUrl = this.configService.get<string>('LENCO_API_BASE_URL', '');
    this.isSandbox = baseUrl.includes('sandbox');
    this.logger.log(
      `PromotionsService initialized. Running in ${
        this.isSandbox ? 'Sandbox' : 'Live'
      } mode.`,
    );
  }

  private guessOperator(phone: string): string {
    if (phone.startsWith('097') || phone.startsWith('077')) return 'airtel';
    if (phone.startsWith('096') || phone.startsWith('076')) return 'mtn';
    if (phone.startsWith('095') || phone.startsWith('075')) return 'zamtel';
    this.logger.warn(
      `Could not determine operator for ${phone}, defaulting to 'airtel'.`,
    );
    return 'airtel'; // Default or throw error if operator is strictly required
  }

  async initiatePromotion(dto: InitiatePromotionDto): Promise<{
    status: string;
    message: string;
    paymentReference: string;
    lencoReference?: string | null; // Include Lenco ref if available
  }> {
    const { propertyId, planId, mobileMoneyNumber } = dto;
    const planDetails = PROMOTION_PLANS[planId];
    const operator = dto.operator || this.guessOperator(mobileMoneyNumber);

    if (!planDetails) {
      throw new BadRequestException('Invalid promotion plan selected.');
    }

    // 1. Validate Property
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

    // 2. Check for Existing Conflicting Promotions
    //    A conflicting promotion is one that is:
    //    a) Already 'successful' (i.e., active and paid) and not yet expired.
    //    b) Still in a payment processing state ('pending', 'otp-required', 'pay-offline').
    const { data: existingPromotion, error: existingError } =
      await this.supabase
        .from('promotions')
        .select('id, payment_status, promotion_expires_at')
        .eq('property_id', propertyId)
        .or(
          `and(payment_status.eq.successful,promotion_expires_at.gt.${new Date().toISOString()}),payment_status.in.("pending","otp-required","pay-offline")`,
        )
        .maybeSingle(); // Expect 0 or 1 conflicting promotion

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
      // If it's 'successful' but expired, or 'failed', it's not a conflict for a new promotion.
    }

    // 3. Create New Promotion Record
    const paymentReference = `PROMO-${uuidv4()}`; // Ensures uniqueness for this attempt
    const promotionData = {
      // id: uuidv4(), // If your DB doesn't auto-generate UUID for primary key
      property_id: propertyId,
      plan_id: planId,
      plan_duration_days: planDetails.durationDays,
      amount_paid: planDetails.price, // This is the expected amount
      currency: planDetails.currency,
      payment_provider: 'lenco',
      payment_reference: paymentReference,
      payment_status: 'pending', // Initial status
      // promotion_starts_at and promotion_expires_at are set after successful payment
    };

    const { data: insertedPromotion, error: insertError } = await this.supabase
      .from('promotions')
      .insert(promotionData)
      .select() // Select the inserted row
      .single();

    if (insertError || !insertedPromotion) {
      // Since the UNIQUE constraint on property_id is gone, a 23505 error
      // would now likely be on the primary key 'id' (if not auto-generated and you provide it)
      // or 'payment_reference' if you added a unique constraint there (which is good practice).
      if (insertError && insertError.code === '23505') {
        this.logger.error(
          `Conflict inserting promotion record for ref ${paymentReference}. This might be a duplicate payment_reference or primary key. Error: ${insertError.message}`,
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

    // 4. Initiate Lenco Payment
    let currentLencoStatus = 'pending'; // Default to pending before Lenco call
    let lencoReference: string | null = null;

    try {
      const lencoResponse =
        await this.lencoService.initiateMobileMoneyCollection({
          reference: paymentReference, // Use the unique payment_reference
          amount: planDetails.price,
          phone: mobileMoneyNumber,
          operator: operator,
          country: 'zm', // Consider making this configurable or part of DTO
        });
      currentLencoStatus = lencoResponse.status.toLowerCase(); // Normalize status
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
        `Failed to initiate Lenco collection for ref ${paymentReference}: ${error.message}`,
        error.stack,
      );
      await this.updatePromotionStatus(paymentReference, 'failed', null); // Mark as failed in DB
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to communicate with payment provider.',
      );
    }

    // 5. Handle OTP for Sandbox (if applicable)
    if (currentLencoStatus === 'otp-required' && this.isSandbox) {
      this.logger.log(
        `Sandbox: OTP required for ref ${paymentReference}. Submitting '000000'.`,
      );
      try {
        const otpResponse = await this.lencoService.submitOtp(
          paymentReference,
          '000000',
        );
        currentLencoStatus = otpResponse.status.toLowerCase(); // Normalize
        lencoReference = otpResponse.lencoReference || lencoReference; // Keep original if OTP response doesn't have it
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
        // Status remains 'otp-required' or might be updated to 'failed' by Lenco if OTP submission fails hard
      }
    }

    // 6. Start Polling Logic (if needed)
    let finalLencoStatus = currentLencoStatus;
    let finalLencoReference = lencoReference;
    let attempts = 0;
    const statusesRequiringPolling = ['pending', 'pay-offline'];
    // 'otp-required' might also need polling if sandbox OTP auto-submit isn't used or fails

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
          finalLencoStatus = verificationResult.status.toLowerCase(); // Normalize
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
            break; // Exit polling if a terminal status is reached
          }
        } else {
          this.logger.warn(
            `Polling attempt ${attempts} failed to verify ref ${paymentReference} (LencoService.verifyPayment returned null).`,
          );
        }
      }

      if (
        attempts >= MAX_POLLING_ATTEMPTS &&
        statusesRequiringPolling.includes(finalLencoStatus)
      ) {
        this.logger.warn(
          `Polling timed out for ref ${paymentReference} after ${attempts} attempts. Final status: ${finalLencoStatus}. Consider it failed or requiring manual check.`,
        );
        // Optionally update status to 'timed_out' or 'verification_failed'
        // finalLencoStatus = 'timed_out';
        // await this.updatePromotionStatus(paymentReference, finalLencoStatus, finalLencoReference);
      }
    }

    // 7. Activate Promotion if Payment Successful
    if (finalLencoStatus === 'successful') {
      try {
        // Fetch the specific promotion record again to ensure we have the correct plan_duration_days
        const { data: promotionToActivate, error: fetchError } =
          await this.supabase
            .from('promotions')
            .select('id, plan_duration_days')
            .eq('payment_reference', paymentReference)
            .eq('id', insertedPromotion.id) // Ensure we're updating the one we just inserted
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
            payment_status: 'successful', // Ensure final status is successful
            lenco_reference: finalLencoReference, // Ensure final Lenco ref is saved
          })
          .eq('id', promotionToActivate.id);

        if (updateTimeError) {
          this.logger.error(
            `Error setting start/expiry for promotion ${
              promotionToActivate.id
            } (ref ${paymentReference}): ${updateTimeError.message}`,
          );
          // Payment was successful, but DB update failed. Critical issue.
          return {
            status: 'success_activation_failed',
            message:
              'Payment successful, but failed to update promotion times. Please contact support.',
            paymentReference: paymentReference,
            lencoReference: finalLencoReference,
          };
        }
        this.logger.log(
          `Promotion ${
            promotionToActivate.id
          } (ref ${paymentReference}) successfully activated. Expires: ${expiresAt.toISOString()}`,
        );
        return {
          status: 'successful', // Use a consistent 'successful' status
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
          status: 'success_activation_failed',
          message:
            'Payment successful, but an error occurred during final activation. Please contact support.',
          paymentReference: paymentReference,
          lencoReference: finalLencoReference,
        };
      }
    } else {
      // Payment was not successful after all attempts
      this.logger.warn(
        `Promotion (ref ${paymentReference}) finished with non-successful status: ${finalLencoStatus}`,
      );
      return {
        status: finalLencoStatus, // e.g., 'failed', 'pending', 'timed_out'
        message: `Payment process ended with status: ${finalLencoStatus}.`,
        paymentReference: paymentReference,
        lencoReference: finalLencoReference,
      };
    }
  }

  // --- verifyAndActivatePromotion ---
  // This method is useful for manual verification or if a webhook provides a final status.
  // It does NOT include the sandbox 'pay-offline' to 'successful' simulation.
  async verifyAndActivatePromotion(paymentReference: string): Promise<{
    status: string;
    message: string;
    lencoReference?: string | null;
  }> {
    this.logger.log(
      `Verifying and activating promotion via dedicated endpoint for ref: ${paymentReference}`,
    );

    const { data: promotion, error: findError } = await this.supabase
      .from('promotions')
      .select('id, payment_status, plan_duration_days, lenco_reference')
      .eq('payment_reference', paymentReference)
      .maybeSingle(); // Use maybeSingle as it might not exist

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
      };
    }

    // Verify with Lenco
    const lencoVerification =
      await this.lencoService.verifyPayment(paymentReference);

    if (!lencoVerification) {
      this.logger.warn(
        `Verify Endpoint: Lenco verification failed or returned null for ref ${paymentReference}. Current DB status: ${promotion.payment_status}`,
      );
      // Avoid overwriting a potentially more informative 'failed' status from Lenco with a generic one here
      // if (promotion.payment_status !== 'failed') {
      //   await this.updatePromotionStatus(paymentReference, 'verification_failed', promotion.lenco_reference);
      // }
      throw new HttpException(
        'Payment verification with Lenco failed or payment not found.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const lencoStatus = lencoVerification.status.toLowerCase(); // Normalize
    const lencoApiReference = lencoVerification.lencoReference;

    this.logger.log(
      `Verify Endpoint: Lenco verification status for ref ${paymentReference}: ${lencoStatus}, Lenco API Ref: ${lencoApiReference}`,
    );

    // Update DB status based on Lenco verification, even if not successful yet
    await this.updatePromotionStatus(
      paymentReference,
      lencoStatus,
      lencoApiReference,
    );

    if (lencoStatus === 'successful') {
      const now = new Date();
      const expiresAt = addDays(now, promotion.plan_duration_days);

      const { error: updateTimeError } = await this.supabase
        .from('promotions')
        .update({
          promotion_starts_at: now.toISOString(),
          promotion_expires_at: expiresAt.toISOString(),
          // payment_status: 'successful', // Already set by updatePromotionStatus
        })
        .eq('id', promotion.id); // Use primary key for update

      if (updateTimeError) {
        this.logger.error(
          `Verify Endpoint: Error setting start/expiry for promotion ${promotion.id} (ref ${paymentReference}): ${updateTimeError.message}`,
        );
        throw new InternalServerErrorException(
          'Failed to activate promotion timing after successful verification.',
        );
      }

      this.logger.log(
        `Verify Endpoint: Promotion ${
          promotion.id
        } (ref ${paymentReference}) successfully activated. Expires: ${expiresAt.toISOString()}`,
      );
      return {
        status: 'successful',
        message: 'Promotion activated successfully.',
        lencoReference: lencoApiReference,
      };
    } else {
      this.logger.warn(
        `Verify Endpoint: Lenco payment status for ref ${paymentReference} is not 'successful': ${lencoStatus}`,
      );
      return {
        status: lencoStatus,
        message: `Payment status from Lenco: ${lencoStatus}`,
        lencoReference: lencoApiReference,
      };
    }
  }

  private async updatePromotionStatus(
    paymentReference: string,
    status: string,
    lencoReference: string | null,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('promotions')
      .update({
        payment_status: status.toLowerCase(), // Ensure consistent casing
        lenco_reference: lencoReference,
        updated_at: new Date().toISOString(),
      })
      .eq('payment_reference', paymentReference);

    if (error) {
      this.logger.error(
        `Failed to update promotion status to '${status}' for ref ${paymentReference}: ${error.message}`,
      );
      // Depending on context, you might want to throw an error here or handle it upstream
    } else {
      this.logger.log(
        `Promotion status updated to '${status}' for ref ${paymentReference}. Lenco Ref: ${lencoReference}`,
      );
    }
  }

  async handleLencoWebhook(payload: any): Promise<void> {
    this.logger.log('Received Lenco webhook');
    this.logger.debug(`Webhook payload: ${JSON.stringify(payload)}`);

    // --- TODO: Implement robust signature validation from Lenco ---
    // const calculatedSignature = crypto.createHmac('sha256', this.configService.get('LENCO_WEBHOOK_SECRET'))
    // .update(JSON.stringify(payload)) // Ensure raw body is used if possible
    // .digest('hex');
    // if (calculatedSignature !== receivedLencoSignature) {
    //   this.logger.error('Invalid Lenco webhook signature.');
    //   throw new BadRequestException('Invalid signature.');
    // }
    // --- End Signature Validation ---

    const eventType = payload.event?.toLowerCase(); // e.g., 'collection.successful', 'collection.failed'
    const data = payload.data;

    if (!data) {
      this.logger.warn('Webhook payload missing data object.');
      return;
    }

    const paymentReference = data.reference; // This should be your unique payment_reference
    const lencoApiReference = data.lencoReference; // Lenco's own transaction ID
    const statusFromWebhook = data.status?.toLowerCase(); // Status from Lenco payload

    if (!paymentReference || !statusFromWebhook || !eventType) {
      this.logger.warn(
        `Webhook payload missing critical fields: reference, status, or event type. Ref: ${paymentReference}, Status: ${statusFromWebhook}, Event: ${eventType}`,
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
      return; // Acknowledge webhook but log error
    }
    if (!promotion) {
      this.logger.warn(
        `Webhook: Promotion record not found for payment_reference ${paymentReference}. Ignoring event.`,
      );
      return;
    }

    // Idempotency: If already successful, don't reprocess unless it's a different kind of update.
    if (promotion.payment_status === 'successful' && statusFromWebhook === 'successful') {
      this.logger.log(
        `Webhook: Promotion ref ${paymentReference} already successful. Ignoring redundant successful event ${eventType}.`,
      );
      return;
    }

    // Map Lenco event/status to your internal statuses
    let internalStatusToSet = promotion.payment_status; // Default to current status
    if (
      eventType.includes('successful') ||
      statusFromWebhook === 'successful'
    ) {
      internalStatusToSet = 'successful';
    } else if (eventType.includes('failed') || statusFromWebhook === 'failed') {
      internalStatusToSet = 'failed';
    } else {
      internalStatusToSet = statusFromWebhook; // Use Lenco's status if not explicitly successful/failed event
    }

    // Update the status first
    await this.updatePromotionStatus(
      paymentReference,
      internalStatusToSet,
      lencoApiReference,
    );

    // If the new status is 'successful', activate the promotion dates
    if (internalStatusToSet === 'successful') {
      // Check again if it was already activated to prevent re-setting dates if webhook is delayed
      const { data: currentPromotionState, error: fetchCurrentError } = await this.supabase
        .from('promotions')
        .select('promotion_starts_at')
        .eq('id', promotion.id)
        .single();

      if (fetchCurrentError) {
          this.logger.error(`Webhook: Error fetching current state for promotion ${promotion.id} before date activation: ${fetchCurrentError.message}`);
          return; // Avoid proceeding if we can't confirm current state
      }

      if (currentPromotionState && !currentPromotionState.promotion_starts_at) {
        try {
          const now = new Date();
          const expiresAt = addDays(now, promotion.plan_duration_days);

          const { error: updateTimeError } = await this.supabase
            .from('promotions')
            .update({
              promotion_starts_at: now.toISOString(),
              promotion_expires_at: expiresAt.toISOString(),
            })
            .eq('id', promotion.id); // Use primary key

          if (updateTimeError) {
            this.logger.error(
              `Webhook: Error setting start/expiry for promotion ${
                promotion.id
              } (ref ${paymentReference}): ${updateTimeError.message}`,
            );
          } else {
            this.logger.log(
              `Webhook: Promotion ${
                promotion.id
              } (ref ${paymentReference}) activated via webhook. Expires: ${expiresAt.toISOString()}`,
            );
          }
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
