import {
  Injectable,
  Inject,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ADMIN } from '../supabase/supabase.constants';
import { CacheService } from '../cache/cache.service';
import { TrackEventDto, EventType } from './dto/track-event.dto';
import { AnalyticsQueryDto, AnalyticsTimeRange } from './dto/analytics-query.dto';

export interface UserEngagementStats {
  total_views: number;
  total_saves: number;
  total_contacts: number;
  total_searches: number;
  unique_properties_viewed: number;
  avg_session_duration: number;
}

export interface PropertyStats {
  property_id: string;
  total_views: number;
  total_saves: number;
  total_contacts: number;
  total_shares: number;
  last_viewed: string;
}

export interface SubscriptionStats {
  total_users: number;
  premium_users: number;
  conversion_rate: number;
  recent_upgrades: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Inject(SUPABASE_SERVICE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Track user events for analytics
   */
  async trackEvent(userId: string, eventDto: TrackEventDto): Promise<void> {
    try {
      const eventData = {
        user_id: userId,
        event_type: eventDto.event_type,
        property_id: eventDto.property_id,
        search_query: eventDto.search_query,
        metadata: eventDto.metadata || {},
        created_at: new Date().toISOString(),
      };

      const { error } = await this.supabase
        .from('user_analytics')
        .insert(eventData);

      if (error) {
        this.logger.error(`Error tracking event: ${error.message}`);
        throw new InternalServerErrorException('Failed to track event');
      }

      // Update cached statistics
      await this.invalidateUserStatsCache(userId);
      
      if (eventDto.property_id) {
        await this.invalidatePropertyStatsCache(eventDto.property_id);
      }

      this.logger.debug(
        `Event tracked: ${eventDto.event_type} for user ${userId}`,
      );
    } catch (error) {
      this.logger.error('Error in trackEvent:', error);
      // Don't throw errors for analytics to avoid disrupting user experience
    }
  }

  /**
   * Get user engagement statistics
   */
  async getUserEngagementStats(
    userId: string,
    query: AnalyticsQueryDto,
  ): Promise<UserEngagementStats> {
    const cacheKey = `user-engagement:${userId}:${query.time_range || '30d'}`;
    
    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<UserEngagementStats>(cacheKey);
      if (cached) {
        return cached;
      }

      const { startDate, endDate } = this.getDateRange(query);

      // Get basic event counts
      const { data: events, error } = await this.supabase
        .from('user_analytics')
        .select('event_type, property_id, created_at')
        .eq('user_id', userId)
        .gte('created_at', startDate)
        .lte('created_at', endDate);

      if (error) {
        throw new InternalServerErrorException('Failed to fetch user stats');
      }

      // Calculate statistics
      const stats: UserEngagementStats = {
        total_views: events.filter(e => e.event_type === EventType.PROPERTY_VIEW).length,
        total_saves: events.filter(e => e.event_type === EventType.PROPERTY_SAVE).length,
        total_contacts: events.filter(e => e.event_type === EventType.PROPERTY_CONTACT).length,
        total_searches: events.filter(e => e.event_type === EventType.SEARCH_PERFORMED).length,
        unique_properties_viewed: new Set(
          events
            .filter(e => e.event_type === EventType.PROPERTY_VIEW && e.property_id)
            .map(e => e.property_id)
        ).size,
        avg_session_duration: 0, // TODO: Implement session tracking
      };

      // Cache the results for 1 hour
      await this.cacheService.set(cacheKey, stats, 3600);
      
      return stats;
    } catch (error) {
      this.logger.error('Error getting user engagement stats:', error);
      throw new InternalServerErrorException('Failed to get user engagement stats');
    }
  }

  /**
   * Get property performance statistics
   */
  async getPropertyStats(
    propertyId: string,
    query: AnalyticsQueryDto,
  ): Promise<PropertyStats> {
    const cacheKey = `property-stats:${propertyId}:${query.time_range || '30d'}`;
    
    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<PropertyStats>(cacheKey);
      if (cached) {
        return cached;
      }

      const { startDate, endDate } = this.getDateRange(query);

      const { data: events, error } = await this.supabase
        .from('user_analytics')
        .select('event_type, created_at')
        .eq('property_id', propertyId)
        .gte('created_at', startDate)
        .lte('created_at', endDate);

      if (error) {
        throw new InternalServerErrorException('Failed to fetch property stats');
      }

      const stats: PropertyStats = {
        property_id: propertyId,
        total_views: events.filter(e => e.event_type === EventType.PROPERTY_VIEW).length,
        total_saves: events.filter(e => e.event_type === EventType.PROPERTY_SAVE).length,
        total_contacts: events.filter(e => e.event_type === EventType.PROPERTY_CONTACT).length,
        total_shares: events.filter(e => e.event_type === EventType.PROPERTY_SHARE).length,
        last_viewed: events
          .filter(e => e.event_type === EventType.PROPERTY_VIEW)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          [0]?.created_at || null,
      };

      // Cache the results for 30 minutes
      await this.cacheService.set(cacheKey, stats, 1800);
      
      return stats;
    } catch (error) {
      this.logger.error('Error getting property stats:', error);
      throw new InternalServerErrorException('Failed to get property stats');
    }
  }

  /**
   * Get subscription statistics (admin only)
   */
  async getSubscriptionStats(): Promise<SubscriptionStats> {
    const cacheKey = 'subscription-stats';
    
    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<SubscriptionStats>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get total users
      const { count: totalUsers, error: usersError } = await this.supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      if (usersError) {
        throw new InternalServerErrorException('Failed to fetch user count');
      }

      // Get premium users (active subscriptions)
      const { count: premiumUsers, error: premiumError } = await this.supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .gte('expires_at', new Date().toISOString());

      if (premiumError) {
        throw new InternalServerErrorException('Failed to fetch premium user count');
      }

      // Get recent upgrades (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { count: recentUpgrades, error: upgradesError } = await this.supabase
        .from('user_subscriptions')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', thirtyDaysAgo.toISOString());

      if (upgradesError) {
        throw new InternalServerErrorException('Failed to fetch recent upgrades');
      }

      const stats: SubscriptionStats = {
        total_users: totalUsers || 0,
        premium_users: premiumUsers || 0,
        conversion_rate: (totalUsers || 0) > 0 ? ((premiumUsers || 0) / (totalUsers || 1)) * 100 : 0,
        recent_upgrades: recentUpgrades || 0,
      };

      // Cache the results for 1 hour
      await this.cacheService.set(cacheKey, stats, 3600);
      
      return stats;
    } catch (error) {
      this.logger.error('Error getting subscription stats:', error);
      throw new InternalServerErrorException('Failed to get subscription stats');
    }
  }

  /**
   * Get top performing properties
   */
  async getTopProperties(limit: number = 10): Promise<PropertyStats[]> {
    const cacheKey = `top-properties:${limit}`;
    
    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<PropertyStats[]>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get properties with most views in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await this.supabase
        .from('user_analytics')
        .select('property_id')
        .eq('event_type', EventType.PROPERTY_VIEW)
        .gte('created_at', thirtyDaysAgo.toISOString())
        .not('property_id', 'is', null);

      if (error) {
        throw new InternalServerErrorException('Failed to fetch top properties');
      }

      // Count views per property
      const propertyViews = data.reduce((acc, row) => {
        acc[row.property_id] = (acc[row.property_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Get top properties and their full stats
      const topPropertyIds = Object.entries(propertyViews)
        .sort(([,a], [,b]) => b - a)
        .slice(0, limit)
        .map(([propertyId]) => propertyId);

      const topProperties = await Promise.all(
        topPropertyIds.map(propertyId =>
          this.getPropertyStats(propertyId, { time_range: AnalyticsTimeRange.LAST_30_DAYS })
        )
      );

      // Cache the results for 2 hours
      await this.cacheService.set(cacheKey, topProperties, 7200);
      
      return topProperties;
    } catch (error) {
      this.logger.error('Error getting top properties:', error);
      throw new InternalServerErrorException('Failed to get top properties');
    }
  }

  /**
   * Helper method to get date range from query
   */
  private getDateRange(query: AnalyticsQueryDto): { startDate: string; endDate: string } {
    const endDate = new Date().toISOString();
    let startDate: string;

    if (query.time_range === AnalyticsTimeRange.CUSTOM && query.start_date && query.end_date) {
      return { startDate: query.start_date, endDate: query.end_date };
    }

    const start = new Date();
    switch (query.time_range) {
      case AnalyticsTimeRange.LAST_7_DAYS:
        start.setDate(start.getDate() - 7);
        break;
      case AnalyticsTimeRange.LAST_30_DAYS:
        start.setDate(start.getDate() - 30);
        break;
      case AnalyticsTimeRange.LAST_90_DAYS:
        start.setDate(start.getDate() - 90);
        break;
      default:
        start.setDate(start.getDate() - 30);
    }

    startDate = start.toISOString();
    return { startDate, endDate };
  }

  /**
   * Cache invalidation helpers
   */
  private async invalidateUserStatsCache(userId: string): Promise<void> {
    try {
      await this.cacheService.deleteByPattern(`user-engagement:${userId}:*`);
    } catch (error) {
      this.logger.error('Error invalidating user stats cache:', error);
    }
  }

  private async invalidatePropertyStatsCache(propertyId: string): Promise<void> {
    try {
      await this.cacheService.deleteByPattern(`property-stats:${propertyId}:*`);
      await this.cacheService.deleteByPattern('top-properties:*');
    } catch (error) {
      this.logger.error('Error invalidating property stats cache:', error);
    }
  }
}