import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly redis: Redis;
  private readonly defaultTtl = 30000; // 30 seconds
  private readonly retryDelay = 100; // 100ms
  private readonly maxRetries = 50; // Maximum retry attempts

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async acquireLock(
    key: string, 
    ttl: number = this.defaultTtl,
    retries: number = this.maxRetries
  ): Promise<string | null> {
    const lockValue = `lock:${Date.now()}:${Math.random()}`;
    
    for (let i = 0; i < retries; i++) {
      const result = await this.redis.set(
        `lock:${key}`,
        lockValue,
        'PX',
        ttl,
        'NX'
      );
      
      if (result === 'OK') {
        this.logger.debug(`Lock acquired: ${key}`);
        return lockValue;
      }
      
      await this.sleep(this.retryDelay);
    }
    
    this.logger.warn(`Failed to acquire lock after ${retries} attempts: ${key}`);
    return null;
  }

  async releaseLock(key: string, lockValue: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    
    const result = await this.redis.eval(script, 1, `lock:${key}`, lockValue);
    const released = result === 1;
    
    if (released) {
      this.logger.debug(`Lock released: ${key}`);
    }
    
    return released;
  }

  async withLock<T>(
    key: string,
    operation: () => Promise<T>,
    ttl: number = this.defaultTtl
  ): Promise<T> {
    const lockValue = await this.acquireLock(key, ttl);
    
    if (!lockValue) {
      throw new Error(`Failed to acquire lock: ${key}`);
    }
    
    try {
      return await operation();
    } finally {
      await this.releaseLock(key, lockValue);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}