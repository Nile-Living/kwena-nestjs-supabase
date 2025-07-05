import { CacheModuleAsyncOptions } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';

export const cacheConfig: CacheModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (configService: ConfigService) => {
    const redisUrl = configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    
    return {
      store: redisStore,
      url: redisUrl,
      ttl: 600, // 10 minutes default TTL
      max: 1000, // Increased for high traffic
      isGlobal: true,
    };
  },
};