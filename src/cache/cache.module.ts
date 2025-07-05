import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { CacheService } from './cache.service';
import { CacheInterceptor } from './cache.interceptor';
import { cacheConfig } from './cache.config';

@Global()
@Module({
  imports: [NestCacheModule.registerAsync(cacheConfig)],
  providers: [CacheService, CacheInterceptor],
  exports: [CacheService, CacheInterceptor, NestCacheModule],
})
export class CacheModule {}