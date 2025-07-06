import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface PerformanceMetrics {
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  timestamp: Date;
  cacheHit?: boolean;
  userAgent?: string;
}

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PerformanceInterceptor.name);
  private metrics: PerformanceMetrics[] = [];
  private readonly MAX_METRICS = 10000; // Keep last 10k requests

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const endTime = Date.now();
        const responseTime = endTime - startTime;

        const metric: PerformanceMetrics = {
          method: request.method,
          url: request.url,
          statusCode: response.statusCode,
          responseTime,
          timestamp: new Date(),
          userAgent: request.headers['user-agent'],
        };

        // Log slow requests
        if (responseTime > 1000) {
          this.logger.warn(
            `Slow request detected: ${metric.method} ${metric.url} - ${responseTime}ms`,
          );
        }

        // Store metric
        this.addMetric(metric);

        // Log performance summary every 100 requests
        if (this.metrics.length % 100 === 0) {
          this.logPerformanceSummary();
        }
      }),
    );
  }

  private addMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric);
    
    // Keep only the last MAX_METRICS entries
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS);
    }
  }

  private logPerformanceSummary(): void {
    if (this.metrics.length === 0) return;

    const last100 = this.metrics.slice(-100);
    const responseTimes = last100.map(m => m.responseTime);
    
    const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const sorted = responseTimes.sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    const errorCount = last100.filter(m => m.statusCode >= 400).length;
    const errorRate = (errorCount / last100.length) * 100;

    this.logger.log(
      `Performance Summary (last 100 requests): ` +
      `Avg: ${avg.toFixed(2)}ms, ` +
      `P50: ${p50}ms, ` +
      `P95: ${p95}ms, ` +
      `P99: ${p99}ms, ` +
      `Error Rate: ${errorRate.toFixed(2)}%`
    );
  }

  /**
   * Get performance metrics for monitoring dashboard
   */
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get performance statistics
   */
  getStats(timeWindow?: number): any {
    const now = Date.now();
    const windowMs = timeWindow ? timeWindow * 60 * 1000 : 5 * 60 * 1000; // Default 5 minutes
    
    const recentMetrics = this.metrics.filter(
      m => now - m.timestamp.getTime() <= windowMs
    );

    if (recentMetrics.length === 0) {
      return { message: 'No metrics available for the specified time window' };
    }

    const responseTimes = recentMetrics.map(m => m.responseTime);
    const sorted = responseTimes.sort((a, b) => a - b);

    const stats = {
      totalRequests: recentMetrics.length,
      timeWindow: `${windowMs / 60000} minutes`,
      responseTime: {
        avg: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
        min: Math.min(...responseTimes),
        max: Math.max(...responseTimes),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      },
      requestsPerSecond: recentMetrics.length / (windowMs / 1000),
      statusCodes: {},
      endpoints: {},
      errors: recentMetrics.filter(m => m.statusCode >= 400).length,
    };

    // Count status codes
    recentMetrics.forEach(m => {
      const code = m.statusCode.toString();
      stats.statusCodes[code] = (stats.statusCodes[code] || 0) + 1;
    });

    // Count endpoints
    recentMetrics.forEach(m => {
      const endpoint = `${m.method} ${m.url.split('?')[0]}`;
      stats.endpoints[endpoint] = (stats.endpoints[endpoint] || 0) + 1;
    });

    stats.responseTime.avg = Number(stats.responseTime.avg.toFixed(2));
    stats.requestsPerSecond = Number(stats.requestsPerSecond.toFixed(2));

    return stats;
  }

  /**
   * Clear metrics (useful for testing)
   */
  clearMetrics(): void {
    this.metrics = [];
    this.logger.log('Performance metrics cleared');
  }
}