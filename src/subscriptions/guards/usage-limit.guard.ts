import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsService } from '../subscriptions.service';

export enum UsageType {
  SAVED_SEARCH = 'saved_search',
  PROPERTY_VIEW = 'property_view',
  PROPERTY_CONTACT = 'property_contact',
}

export const CheckUsageLimit = (usageType: UsageType) =>
  Reflect.metadata('usageType', usageType);

@Injectable()
export class UsageLimitGuard implements CanActivate {
  private readonly logger = new Logger(UsageLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const usageType = this.reflector.get<UsageType>(
      'usageType',
      context.getHandler(),
    );

    if (!usageType) {
      // No usage limit check required
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new ForbiddenException('Authentication required');
    }

    try {
      const canProceed = await this.checkUsageLimit(user.id, usageType);
      
      if (!canProceed) {
        const limitInfo = await this.getUsageLimitInfo(user.id, usageType);
        
        this.logger.warn(
          `User ${user.id} exceeded usage limit for: ${usageType}`,
        );
        
        throw new ForbiddenException(
          `You have reached your ${usageType.replace('_', ' ')} limit of ${limitInfo.limit}. Upgrade to premium for unlimited access.`,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      
      this.logger.error(
        `Error checking usage limit for user ${user.id}:`,
        error,
      );
      
      // In case of errors, allow access but log the issue
      return true;
    }
  }

  private async checkUsageLimit(
    userId: string,
    usageType: UsageType,
  ): Promise<boolean> {
    switch (usageType) {
      case UsageType.SAVED_SEARCH:
        return await this.subscriptionsService.canUserSaveMoreSearches(userId);
        
      case UsageType.PROPERTY_VIEW:
        // For MVP, we'll allow unlimited property views
        // This can be restricted later for free users
        return true;
        
      case UsageType.PROPERTY_CONTACT:
        // For MVP, we'll allow contacts but could add limits later
        return true;
        
      default:
        return true;
    }
  }

  private async getUsageLimitInfo(
    userId: string,
    usageType: UsageType,
  ): Promise<{ current: number; limit: number }> {
    const features = await this.subscriptionsService.getUserSubscriptionFeatures(userId);
    
    switch (usageType) {
      case UsageType.SAVED_SEARCH:
        const currentCount = await this.subscriptionsService.getUserSavedSearchCount(userId);
        return {
          current: currentCount,
          limit: features?.max_saved_searches || 0,
        };
        
      default:
        return { current: 0, limit: 0 };
    }
  }
}