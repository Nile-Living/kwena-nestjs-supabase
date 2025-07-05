import { CacheModuleAsyncOptions } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
const { redisStore } = require('cache-manager-redis-yet');

export const cacheConfig: CacheModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (configService: ConfigService) => {
    const logger = new Logger('CacheConfig');
    const redisUrl = configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    const isProduction = configService.get<string>('NODE_ENV') === 'production';
    
    logger.log(`Configuring Redis cache for ${isProduction ? 'production' : 'development'} environment`);
    logger.log(`Redis URL: ${redisUrl.replace(/\/\/.*@/, '//***@')}`); // Hide credentials in logs
    
    return {
      store: redisStore,
      url: redisUrl,
      ttl: 600, // 10 minutes default TTL in seconds
      max: isProduction ? 10000 : 1000, // Higher limit for production
      isGlobal: true,
      // Redis-specific options for production
      ...(isProduction && {
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        commandTimeout: 5000,
        // Enable Redis persistence in production
        keyPrefix: 'kwena:cache:',
      }),
      // Development-specific options
      ...(!isProduction && {
        keyPrefix: 'kwena:dev:cache:',
      })
    };
  },
};