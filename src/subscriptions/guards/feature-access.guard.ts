import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsService } from '../subscriptions.service';

export enum RequiredFeature {
  SAVE_SEARCH = 'save_search',
  PRIORITY_NOTIFICATIONS = 'priority_notifications',
  ADVANCED_FILTERS = 'advanced_filters',
  PROPERTY_ANALYTICS = 'property_analytics',
  BULK_OPERATIONS = 'bulk_operations',
  PREMIUM_CONTACT = 'premium_contact',
}

export const RequireFeature = (feature: RequiredFeature) =>
  Reflect.metadata('requiredFeature', feature);

@Injectable()
export class FeatureAccessGuard implements CanActivate {
  private readonly logger = new Logger(FeatureAccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.get<RequiredFeature>(
      'requiredFeature',
      context.getHandler(),
    );

    if (!requiredFeature) {
      // No feature requirement, allow access
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new ForbiddenException('Authentication required');
    }

    try {
      // Check if user has access to the required feature
      const hasAccess = await this.checkFeatureAccess(user.id, requiredFeature);
      
      if (!hasAccess) {
        this.logger.warn(
          `User ${user.id} denied access to feature: ${requiredFeature}`,
        );
        throw new ForbiddenException(
          `This feature requires a premium subscription. Please upgrade to access ${requiredFeature.replace('_', ' ')}.`,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      
      this.logger.error(
        `Error checking feature access for user ${user.id}:`,
        error,
      );
      
      // In case of errors, deny access to be safe
      throw new ForbiddenException('Unable to verify feature access');
    }
  }

  private async checkFeatureAccess(
    userId: string,
    feature: RequiredFeature,
  ): Promise<boolean> {
    const subscription = await this.subscriptionsService.getUserActiveSubscription(userId);
    
    if (!subscription || !subscription.features) {
      return false;
    }

    const features = subscription.features;

    switch (feature) {
      case RequiredFeature.SAVE_SEARCH:
        return features.max_saved_searches > 0;
        
      case RequiredFeature.PRIORITY_NOTIFICATIONS:
        return features.priority_notifications;
        
      case RequiredFeature.ADVANCED_FILTERS:
        return features.advanced_filters;
        
      case RequiredFeature.PROPERTY_ANALYTICS:
        return features.analytics_access || false;
        
      case RequiredFeature.BULK_OPERATIONS:
        // Available for premium and enterprise
        return ['premium', 'enterprise'].includes(subscription.subscription_type.toLowerCase());
        
      case RequiredFeature.PREMIUM_CONTACT:
        // Available for all premium users
        return subscription.subscription_type.toLowerCase() !== 'basic';
        
      default:
        return false;
    }
  }
}