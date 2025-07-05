import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MonitoringController } from './monitoring.controller';
import { PerformanceInterceptor } from './performance.interceptor';
import { CacheModule } from '../cache/cache.module';

@Global()
@Module({
  imports: [CacheModule],
  controllers: [MonitoringController],
  providers: [
    PerformanceInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: PerformanceInterceptor,
    },
  ],
  exports: [PerformanceInterceptor],
})
export class MonitoringModule {}