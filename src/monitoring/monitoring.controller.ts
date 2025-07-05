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
    // This would require Redis client access through the cache service
    // For now, return basic cache info
    return {
      message: 'Cache information endpoint',
      suggestion: 'Use redis-cli info stats for detailed Redis metrics',
      ttlSettings: {
        propertiesList: '5 minutes',
        propertyDetail: '15 minutes',
        userData: '10 minutes',
        staticData: '1 hour',
        adTracking: '24 hours',
      },
    };
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