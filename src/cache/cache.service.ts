import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';

export interface CacheKeyOptions {
  prefix?: string;
  userId?: string;
  filters?: Record<string, any>;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  /**
   * Generate standardized cache keys
   */
  generateKey(type: string, options: CacheKeyOptions = {}): string {
    const parts = [type];
    
    if (options.prefix) parts.push(options.prefix);
    if (options.userId) parts.push(`user:${options.userId}`);
    if (options.page !== undefined) parts.push(`page:${options.page}`);
    if (options.pageSize !== undefined) parts.push(`size:${options.pageSize}`);
    
    if (options.filters) {
      const filterString = Object.entries(options.filters)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${value}`)
        .join(',');
      
      if (filterString) parts.push(`filters:${filterString}`);
    }
    
    return parts.join(':');
  }

  /**
   * Get cached data with logging
   */
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const cached = await this.cacheManager.get<T>(key);
      if (cached !== undefined && cached !== null) {
        this.logger.debug(`Cache HIT: ${key}`);
        return cached;
      } else {
        this.logger.debug(`Cache MISS: ${key}`);
        return undefined;
      }
    } catch (error) {
      this.logger.error(`Cache GET error for key ${key}:`, error);
      return undefined;
    }
  }

  /**
   * Set cached data with logging
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      await this.cacheManager.set(key, value, ttl);
      this.logger.debug(`Cache SET: ${key} (TTL: ${ttl || 'default'})`);
    } catch (error) {
      this.logger.error(`Cache SET error for key ${key}:`, error);
    }
  }

  /**
   * Delete cached data
   */
  async delete(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
      this.logger.debug(`Cache DELETE: ${key}`);
    } catch (error) {
      this.logger.error(`Cache DELETE error for key ${key}:`, error);
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async deleteByPattern(pattern: string): Promise<void> {
    try {
      // This requires Redis store with pattern support
      const redisStore = (this.cacheManager as any).store;
      if (redisStore && redisStore.client && redisStore.client.keys) {
        const keys = await redisStore.client.keys(pattern);
        if (keys.length > 0) {
          await redisStore.client.del(...keys);
          this.logger.debug(`Cache DELETE PATTERN: ${pattern} (${keys.length} keys)`);
        }
      } else {
        this.logger.warn(`Pattern deletion not supported for this cache store type`);
      }
    } catch (error) {
      this.logger.error(`Cache DELETE PATTERN error for ${pattern}:`, error);
    }
  }

  /**
   * Cache TTL constants for different data types
   */
  static readonly TTL = {
    PROPERTIES_LIST: 5 * 60, // 5 minutes for property listings
    PROPERTY_DETAIL: 15 * 60, // 15 minutes for individual properties
    USER_DATA: 10 * 60, // 10 minutes for user-specific data
    STATIC_DATA: 60 * 60, // 1 hour for static/reference data
    AD_TRACKING: 24 * 60 * 60, // 24 hours for ad cycle tracking
  };
}