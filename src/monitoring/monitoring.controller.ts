import { Controller, Get, Query, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { PerformanceInterceptor } from './performance.interceptor';
import { CacheService } from '../cache/cache.service';

@Controller('monitoring')
export class MonitoringController {
  constructor(
    private readonly performanceInterceptor: PerformanceInterceptor,
    private readonly cacheService: CacheService,
  ) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  @Get('performance')
  @HttpCode(HttpStatus.OK)
  async getPerformanceStats(@Query('timeWindow') timeWindow?: string) {
    const windowMinutes = timeWindow ? parseInt(timeWindow) : 5;
    return this.performanceInterceptor.getStats(windowMinutes);
  }

  @Get('performance/raw')
  @HttpCode(HttpStatus.OK)
  async getRawMetrics(@Query('limit') limit?: string) {
    const metrics = this.performanceInterceptor.getMetrics();
    const limitNum = limit ? parseInt(limit) : 100;
    return {
      total: metrics.length,
      metrics: metrics.slice(-limitNum).reverse(), // Most recent first
    };
  }

  @Post('performance/clear')
  @HttpCode(HttpStatus.OK)
  async clearMetrics() {
    this.performanceInterceptor.clearMetrics();
    return { message: 'Performance metrics cleared' };
  }

  @Get('cache/info')
  @HttpCode(HttpStatus.OK)
  async getCacheInfo() {
    try {
      // Try to get Redis connection info through cache service
      const stores = (this.cacheService as any).cacheManager.store;
      let redisInfo: any = null;
      
      if (stores && stores.client) {
        try {
          // Get basic Redis info
          redisInfo = {
            connected: stores.client.isReady || stores.client.connected || true,
            host: stores.client.options?.host || 'localhost',
            port: stores.client.options?.port || 6379,
            db: stores.client.options?.db || 0,
          };
        } catch (error) {
          redisInfo = { error: 'Could not access Redis client info' };
        }
      }

      return {
        status: 'ok',
        cacheImplementation: 'Redis via cache-manager-redis-yet',
        redisConnection: redisInfo,
        ttlSettings: {
          propertiesList: `${CacheService.TTL.PROPERTIES_LIST} seconds (${CacheService.TTL.PROPERTIES_LIST / 60} minutes)`,
          propertyDetail: `${CacheService.TTL.PROPERTY_DETAIL} seconds (${CacheService.TTL.PROPERTY_DETAIL / 60} minutes)`,
          userData: `${CacheService.TTL.USER_DATA} seconds (${CacheService.TTL.USER_DATA / 60} minutes)`,
          staticData: `${CacheService.TTL.STATIC_DATA} seconds (${CacheService.TTL.STATIC_DATA / 60} minutes)`,
          adTracking: `${CacheService.TTL.AD_TRACKING} seconds (${CacheService.TTL.AD_TRACKING / 60 / 60} hours)`,
        },
        cachingStrategy: {
          level1: 'API Response Caching (5-15 minutes)',
          level2: 'Database Query Caching (30 minutes)',
          level3: 'Static/Reference Data Caching (1-24 hours)',
        },
        suggestion: 'Use redis-cli info stats for detailed Redis server metrics',
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Could not retrieve cache info',
        error: error.message,
        ttlSettings: {
          propertiesList: '5 minutes',
          propertyDetail: '15 minutes',
          userData: '10 minutes',
          staticData: '1 hour',
          adTracking: '24 hours',
        },
      };
    }
  }

  @Get('cache/stats')
  @HttpCode(HttpStatus.OK)
  async getCacheStats() {
    try {
      // Try to access Redis stats through cache service
      const stores = (this.cacheService as any).cacheManager.store;
      
      if (stores && stores.client) {
        try {
          // Get Redis info if available
          const info = await stores.client.info('stats');
          const memory = await stores.client.info('memory');
          
          return {
            status: 'ok',
            stats: this.parseRedisInfo(info),
            memory: this.parseRedisInfo(memory),
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            status: 'error',
            message: 'Could not retrieve Redis stats',
            error: error.message,
            suggestion: 'Use redis-cli info stats for direct Redis metrics',
          };
        }
      }
      
      return {
        status: 'unavailable',
        message: 'Redis client not accessible through cache service',
        suggestion: 'Use redis-cli info stats for Redis metrics',
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Cache stats endpoint error',
        error: error.message,
      };
    }
  }

  private parseRedisInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = info.split('\r\n');
    
    for (const line of lines) {
      if (line && !line.startsWith('#') && line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = value;
      }
    }
    
    return result;
  }

  @Get('system')
  @HttpCode(HttpStatus.OK)
  async getSystemInfo() {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      pid: process.pid,
    };
  }
}