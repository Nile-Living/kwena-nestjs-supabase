// src/subscriptions/subscriptions.service.ts
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ADMIN } from '../supabase/supabase.constants';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CreateSubscriptionDto,
  SubscriptionType,
} from './dto/create-subscription.dto';
import {
  UpdateSubscriptionDto,
  SubscriptionStatus,
} from './dto/update-subscription.dto';
import { SubscriptionFeaturesDto } from './dto/subscription-features.dto';
import { CacheService } from '../cache/cache.service';

export interface UserSubscription {
  id: string;
  user_id: string;
  subscription_type: string;
  status: string;
  starts_at: string;
  expires_at: string;
  payment_reference?: string;
  amount_paid?: number;
  currency: string;
  created_at: string;
  updated_at: string;
  features?: SubscriptionFeaturesDto;
}

export interface SubscriptionPlan {
  type: SubscriptionType;
  name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  features: SubscriptionFeaturesDto;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  // Define subscription plans
  private readonly subscriptionPlans: Record<
    SubscriptionType,
    SubscriptionPlan
  > = {
    [SubscriptionType.BASIC]: {
      type: SubscriptionType.BASIC,
      name: 'Basic Plan',
      description: 'Perfect for casual property seekers in Zambia',
      price_monthly: 50, // ZMW (affordable for local market)
      price_yearly: 500,
      features: {
        max_saved_searches: 3,
        priority_notifications: false,
        advanced_filters: false,
        property_alerts: true,
        api_rate_limit: 100,
        analytics_access: false,
        verified_contact: false,
        priority_support: false,
        bulk_operations: false,
        premium_badge: false,
      },
    },
    [SubscriptionType.PREMIUM]: {
      type: SubscriptionType.PREMIUM,
      name: 'Premium Plan',
      description: 'For serious property hunters and investors',
      price_monthly: 120, // ZMW (adjusted for Zambian market)
      price_yearly: 1200,
      features: {
        max_saved_searches: 15,
        priority_notifications: true,
        advanced_filters: true,
        property_alerts: true,
        api_rate_limit: 500,
        analytics_access: true,
        verified_contact: true,
        priority_support: true,
        bulk_operations: false,
        premium_badge: true,
      },
    },
    [SubscriptionType.ENTERPRISE]: {
      type: SubscriptionType.ENTERPRISE,
      name: 'Agent & Business Plan',
      description: 'For real estate agents and property businesses',
      price_monthly: 250, // ZMW (competitive for agents)
      price_yearly: 2500,
      features: {
        max_saved_searches: -1, // Unlimited
        priority_notifications: true,
        advanced_filters: true,
        property_alerts: true,
        api_rate_limit: -1, // Unlimited
        analytics_access: true,
        verified_contact: true,
        priority_support: true,
        bulk_operations: true,
        premium_badge: true,
      },
    },
  };

  constructor(
    @Inject(SUPABASE_SERVICE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly cacheService: CacheService,
  ) {}

  // Check and update expired subscriptions
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkExpiredSubscriptions() {
    this.logger.log('Checking for expired subscriptions...');

    try {
      const { data: expiredSubscriptions, error } = await this.supabase
        .from('user_subscriptions')
        .select('*')
        .eq('status', 'active')
        .lt('expires_at', new Date().toISOString());

      if (error) {
        this.logger.error(
          `Error fetching expired subscriptions: ${error.message}`,
        );
        return;
      }

      if (!expiredSubscriptions || expiredSubscriptions.length === 0) {
        this.logger.log('No expired subscriptions found');
        return;
      }

      this.logger.log(
        `Found ${expiredSubscriptions.length} expired subscriptions`,
      );

      for (const subscription of expiredSubscriptions) {
        await this.updateSubscriptionStatus(
          subscription.id,
          SubscriptionStatus.EXPIRED,
        );
        this.logger.log(
          `Marked subscription ${subscription.id} as expired for user ${subscription.user_id}`,
        );
      }
    } catch (error) {
      this.logger.error('Error in checkExpiredSubscriptions:', error);
    }
  }

  async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    return Object.values(this.subscriptionPlans);
  }

  async getSubscriptionPlan(type: SubscriptionType): Promise<SubscriptionPlan> {
    const plan = this.subscriptionPlans[type];
    if (!plan) {
      throw new NotFoundException(`Subscription plan ${type} not found`);
    }
    return plan;
  }

async createSubscription(
  userId: string,
  dto: CreateSubscriptionDto,
): Promise<UserSubscription> {
  this.logger.log(
    `Creating subscription for user ${userId} with payment reference ${dto.payment_reference}`,
  );

  // Verify user exists and is a regular user
  const { data: userProfile, error: profileError } = await this.supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (profileError || !userProfile) {
    this.logger.error(
      `Failed to verify user profile for ${userId}: ${profileError?.message}`,
    );
    throw new InternalServerErrorException('Failed to verify user profile');
  }

  if (userProfile.role !== 'user') {
    throw new BadRequestException(
      'Subscriptions are only available for regular users',
    );
  }

  // Validate subscription plan exists
  const plan = await this.getSubscriptionPlan(dto.subscription_type);
  if (!plan) {
    throw new BadRequestException(
      `Invalid subscription type: ${dto.subscription_type}`,
    );
  }

  // Check if subscription with this payment reference already exists
  if (dto.payment_reference) {
    const existingByPaymentRef = await this.getSubscriptionByPaymentReference(
      dto.payment_reference,
    );

    if (existingByPaymentRef) {
      if (
        existingByPaymentRef.user_id === userId &&
        existingByPaymentRef.status === 'active'
      ) {
        this.logger.log(
          `Subscription already exists for payment reference ${dto.payment_reference}, returning existing subscription`,
        );
        return existingByPaymentRef;
      } else if (existingByPaymentRef.user_id !== userId) {
        this.logger.error(
          `Payment reference ${dto.payment_reference} is associated with different user`,
        );
        throw new BadRequestException(
          'Payment reference is associated with a different user',
        );
      } else if (existingByPaymentRef.status !== 'active') {
        this.logger.log(
          `Found existing subscription with payment reference ${dto.payment_reference} but status is ${existingByPaymentRef.status}. Will update it.`,
        );
        
        // Update the existing subscription to active
        const startsAt = new Date();
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + dto.duration_months);

        const { data: updatedSubscription, error: updateError } = await this.supabase
          .from('user_subscriptions')
          .update({
            status: 'active',
            starts_at: startsAt.toISOString(),
            expires_at: expiresAt.toISOString(),
            amount_paid: dto.amount_paid,
            currency: dto.currency || 'ZMW',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingByPaymentRef.id)
          .select()
          .single();

        if (updateError) {
          this.logger.error(
            `Error updating existing subscription: ${updateError.message}`,
          );
          throw new InternalServerErrorException('Failed to update subscription');
        }

        this.logger.log(
          `Updated existing subscription ${existingByPaymentRef.id} to active status`,
        );

        return { ...updatedSubscription, features: plan.features };
      }
    }
  }

  // Check if user already has an active subscription (different payment reference)
  const existingActiveSubscription = await this.getUserActiveSubscription(userId);
  if (
    existingActiveSubscription &&
    existingActiveSubscription.payment_reference !== dto.payment_reference
  ) {
    this.logger.warn(
      `User ${userId} already has an active subscription with payment reference ${existingActiveSubscription.payment_reference}, but new payment reference is ${dto.payment_reference}`,
    );
    
    // If the existing subscription expires soon (within 7 days), we can extend it
    const existingExpiresAt = new Date(existingActiveSubscription.expires_at);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((existingExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilExpiry <= 7) {
      this.logger.log(
        `Existing subscription expires in ${daysUntilExpiry} days. Extending it instead of creating new one.`,
      );
      
      const newExpiresAt = new Date(existingExpiresAt);
      newExpiresAt.setMonth(newExpiresAt.getMonth() + dto.duration_months);

      const { data: extendedSubscription, error: extendError } = await this.supabase
        .from('user_subscriptions')
        .update({
          expires_at: newExpiresAt.toISOString(),
          payment_reference: dto.payment_reference, // Update to new payment reference
          amount_paid: (existingActiveSubscription.amount_paid || 0) + (dto.amount_paid || 0),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingActiveSubscription.id)
        .select()
        .single();

      if (extendError) {
        this.logger.error(`Error extending subscription: ${extendError.message}`);
        throw new InternalServerErrorException('Failed to extend subscription');
      }

      this.logger.log(
        `Extended existing subscription ${existingActiveSubscription.id} until ${newExpiresAt.toISOString()}`,
      );

      return { ...extendedSubscription, features: plan.features };
    } else {
      throw new BadRequestException(
        `User already has an active subscription that expires on ${existingExpiresAt.toLocaleDateString()}. Cannot create another subscription.`,
      );
    }
  }

  // Calculate subscription dates
  const startsAt = new Date();
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + dto.duration_months);

  // Create new subscription
  const subscriptionData = {
    user_id: userId,
    subscription_type: dto.subscription_type,
    starts_at: startsAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    payment_reference: dto.payment_reference,
    amount_paid: dto.amount_paid,
    currency: dto.currency || 'ZMW',
    status: 'active',
  };

  this.logger.log(
    `Inserting new subscription with data: ${JSON.stringify(subscriptionData)}`,
  );

  const { data, error } = await this.supabase
    .from('user_subscriptions')
    .insert(subscriptionData)
    .select()
    .single();

  if (error) {
    this.logger.error(`Error creating subscription: ${error.message}`);
    
    // Handle specific database errors
    if (error.code === '23505') {
      // Unique constraint violation
      if (error.message.includes('unique_active_payment_reference')) {
        this.logger.log(
          `Unique constraint violation for payment reference ${dto.payment_reference}. Fetching existing subscription.`,
        );
        
        // Try to fetch the existing subscription
        const existingSubscription = await this.getSubscriptionByPaymentReference(
          dto.payment_reference!,
        );
        
        if (existingSubscription && existingSubscription.user_id === userId) {
          return existingSubscription;
        }
      }
      
      throw new ConflictException(
        'A subscription with this payment reference already exists',
      );
    }
    
    throw new InternalServerErrorException('Failed to create subscription');
  }

  if (!data) {
    this.logger.error('No data returned from subscription creation');
    throw new InternalServerErrorException('Failed to create subscription - no data returned');
  }

  this.logger.log(
    `Successfully created subscription ${data.id} for user ${userId} with payment reference ${dto.payment_reference}`,
  );

  return { ...data, features: plan.features };
}

  async getUserSubscriptions(userId: string): Promise<UserSubscription[]> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching user subscriptions: ${error.message}`);
      throw new InternalServerErrorException('Failed to fetch subscriptions');
    }

    return (data || []).map((subscription) => ({
      ...subscription,
      features:
        this.subscriptionPlans[
          subscription.subscription_type as SubscriptionType
        ]?.features,
    }));
  }

  async getUserActiveSubscription(
    userId: string,
  ): Promise<UserSubscription | null> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gte('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Error fetching user active subscription: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to fetch active subscription',
      );
    }

    if (!data) {
      return null;
    }

    return {
      ...data,
      features:
        this.subscriptionPlans[data.subscription_type as SubscriptionType]
          ?.features,
    };
  }

  async isUserSubscribed(userId: string): Promise<boolean> {
    const subscription = await this.getUserActiveSubscription(userId);
    return !!subscription;
  }

  async getSubscriptionByPaymentReference(
    paymentReference: string,
  ): Promise<UserSubscription | null> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('*')
      .eq('payment_reference', paymentReference)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Error fetching subscription by payment reference: ${error.message}`,
      );
      return null;
    }

    if (!data) {
      return null;
    }

    return {
      ...data,
      features:
        this.subscriptionPlans[data.subscription_type as SubscriptionType]
          ?.features,
    };
  }

  // Also add the recovery method mentioned earlier
  async recoverSubscriptionByPaymentReference(
    userId: string,
    paymentReference: string,
  ): Promise<UserSubscription | null> {
    // First check if subscription exists
    const existingSubscription =
      await this.getSubscriptionByPaymentReference(paymentReference);

    if (existingSubscription && existingSubscription.user_id === userId) {
      this.logger.log(
        `Found existing subscription for payment reference ${paymentReference}`,
      );
      return existingSubscription;
    }

    // If no subscription found, try to create one (recovery mechanism)
    try {
      this.logger.log(
        `Attempting to recover subscription for payment ${paymentReference}`,
      );

      const startsAt = new Date();
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      const { data, error } = await this.supabase
        .from('user_subscriptions')
        .insert({
          user_id: userId,
          subscription_type: SubscriptionType.BASIC,
          starts_at: startsAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          payment_reference: paymentReference,
          amount_paid: 129,
          currency: 'ZMW',
          status: 'active',
        })
        .select()
        .single();

      if (error) {
        this.logger.error(
          `Failed to create recovery subscription: ${error.message}`,
        );
        return null;
      }

      this.logger.log(
        `Recovery subscription created for user ${userId}, payment ${paymentReference}`,
      );

      return {
        ...data,
        features: this.subscriptionPlans[SubscriptionType.BASIC].features,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to recover subscription for payment ${paymentReference}:`,
        error,
      );
      return null;
    }
  }

  async getUserSubscriptionFeatures(
    userId: string,
  ): Promise<SubscriptionFeaturesDto | null> {
    const subscription = await this.getUserActiveSubscription(userId);
    return subscription?.features || null;
  }

  async updateSubscription(
    userId: string,
    subscriptionId: string,
    dto: UpdateSubscriptionDto,
  ): Promise<UserSubscription> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .update({
        ...dto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating subscription: ${error.message}`);
      throw new InternalServerErrorException('Failed to update subscription');
    }

    if (!data) {
      throw new NotFoundException('Subscription not found');
    }

    return {
      ...data,
      features:
        this.subscriptionPlans[data.subscription_type as SubscriptionType]
          ?.features,
    };
  }

  async cancelSubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<void> {
    await this.updateSubscription(userId, subscriptionId, {
      status: SubscriptionStatus.CANCELLED,
    });
  }

  async renewSubscription(
    userId: string,
    subscriptionId: string,
    duration_months: number,
  ): Promise<UserSubscription> {
    const subscription = await this.getSubscriptionById(userId, subscriptionId);

    const newExpiresAt = new Date(subscription.expires_at);
    newExpiresAt.setMonth(newExpiresAt.getMonth() + duration_months);

    return this.updateSubscription(userId, subscriptionId, {
      expires_at: newExpiresAt.toISOString(),
      status: SubscriptionStatus.ACTIVE,
    });
  }

  async getSubscriptionById(
    userId: string,
    subscriptionId: string,
  ): Promise<UserSubscription> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Subscription not found');
    }

    return {
      ...data,
      features:
        this.subscriptionPlans[data.subscription_type as SubscriptionType]
          ?.features,
    };
  }

  private async updateSubscriptionStatus(
    subscriptionId: string,
    status: SubscriptionStatus,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('user_subscriptions')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId);

    if (error) {
      this.logger.error(`Error updating subscription status: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to update subscription status',
      );
    }
  }

  // Helper method to check if user can perform action based on subscription
  async canUserPerformAction(
    userId: string,
    action: 'save_search' | 'priority_notifications' | 'advanced_filters',
  ): Promise<boolean> {
    const features = await this.getUserSubscriptionFeatures(userId);

    if (!features) return false;

    switch (action) {
      case 'save_search':
        return features.max_saved_searches > 0;
      case 'priority_notifications':
        return features.priority_notifications;
      case 'advanced_filters':
        return features.advanced_filters;
      default:
        return false;
    }
  }

  async getUserSavedSearchCount(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('saved_searches')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Error counting saved searches: ${error.message}`);
      return 0;
    }

    return count || 0;
  }

  async canUserSaveMoreSearches(userId: string): Promise<boolean> {
    const features = await this.getUserSubscriptionFeatures(userId);
    if (!features) return false;

    // Unlimited searches for enterprise
    if (features.max_saved_searches === -1) return true;

    const currentCount = await this.getUserSavedSearchCount(userId);
    return currentCount < features.max_saved_searches;
  }

  /**
   * Invalidate subscription-related caches for a user
   */
  private async invalidateUserSubscriptionCaches(userId: string): Promise<void> {
    try {
      await Promise.all([
        this.cacheService.deleteByPattern(`kwena:*:cache:subscriptions:*user:${userId}*`),
        this.cacheService.deleteByPattern(`kwena:*:cache:profiles:*user:${userId}*`),
      ]);
      
      this.logger.debug(`Subscription caches invalidated for user ${userId}`);
    } catch (error) {
      this.logger.error(`Error invalidating subscription caches for user ${userId}:`, error);
    }
  }

  /**
   * Invalidate static subscription plan caches
   */
  private async invalidateSubscriptionPlanCaches(): Promise<void> {
    try {
      await Promise.all([
        this.cacheService.deleteByPattern('kwena:*:cache:subscriptions:plans*'),
        this.cacheService.deleteByPattern('kwena:*:cache:subscriptions:plan*'),
      ]);
      
      this.logger.debug('Subscription plan caches invalidated');
    } catch (error) {
      this.logger.error('Error invalidating subscription plan caches:', error);
    }
  }
}
