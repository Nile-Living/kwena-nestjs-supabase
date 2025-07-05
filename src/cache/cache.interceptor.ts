import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheService } from './cache.service';
import { Reflector } from '@nestjs/core';

export const CACHE_KEY_METADATA = 'cache_key';
export const CACHE_TTL_METADATA = 'cache_ttl';

/**
 * Decorator to enable caching for endpoints
 */
export const CacheResponse = (keyPrefix: string, ttl?: number) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(CACHE_KEY_METADATA, keyPrefix, descriptor.value);
    if (ttl) {
      Reflect.defineMetadata(CACHE_TTL_METADATA, ttl, descriptor.value);
    }
  };
};

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInterceptor.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const cacheKeyPrefix = this.reflector.get<string>(
      CACHE_KEY_METADATA,
      context.getHandler(),
    );

    if (!cacheKeyPrefix) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const { query, params, user } = request;

    // Generate cache key
    const cacheKey = this.cacheService.generateKey(cacheKeyPrefix, {
      userId: user?.id,
      filters: query,
      ...params,
    });

    // Try to get from cache
    const cachedResult = await this.cacheService.get(cacheKey);
    if (cachedResult) {
      this.logger.debug(`Returning cached result for: ${cacheKey}`);
      return of(cachedResult);
    }

    // If not cached, execute handler and cache result
    const ttl = this.reflector.get<number>(
      CACHE_TTL_METADATA,
      context.getHandler(),
    ) || CacheService.TTL.PROPERTIES_LIST;

    return next.handle().pipe(
      tap(async (result) => {
        if (result && !result.error) {
          await this.cacheService.set(cacheKey, result, ttl);
          this.logger.debug(`Cached result for: ${cacheKey}`);
        }
      }),
    );
  }
}