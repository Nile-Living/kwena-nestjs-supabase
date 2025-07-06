# Redis Caching Implementation for Kwena Properties Backend

## Overview

This document describes the comprehensive Redis caching strategy implemented to handle 1000+ concurrent users efficiently.

## Architecture

### Multi-Level Caching Strategy
- **L1**: API Response Caching (5-15 minutes)
- **L2**: Database Query Caching (30 minutes) 
- **L3**: Static/Reference Data Caching (1-24 hours)

### Cache TTL Settings
```typescript
PROPERTIES_LIST: 5 * 60,     // 5 minutes for property listings
PROPERTY_DETAIL: 15 * 60,    // 15 minutes for individual properties  
USER_DATA: 10 * 60,          // 10 minutes for user-specific data
STATIC_DATA: 60 * 60,        // 1 hour for static/reference data
AD_TRACKING: 24 * 60 * 60,   // 24 hours for ad cycle tracking
```

## Setup Instructions

### 1. Install Redis

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Docker:**
```bash
docker run -d --name redis -p 6379:6379 redis:latest
```

### 2. Environment Configuration

Add to your `.env` file:
```env
REDIS_URL=redis://localhost:6379
# For production with authentication:
# REDIS_URL=redis://username:password@host:port
```

### 3. Verify Installation

Test Redis connection:
```bash
redis-cli ping
# Should return: PONG
```

## Implementation Details

### Cache Key Structure
```
{type}:{prefix}:{user:userId}:{page:X}:{size:Y}:{filters:key1:value1,key2:value2}
```

Examples:
- `properties:list:page:1:size:20:filters:category:house,location:Lilongwe`
- `properties:detail:property-id-123`
- `properties:promoted:page:1:size:10`

### Cached Endpoints

| Endpoint | Cache Key | TTL | Description |
|----------|-----------|-----|-------------|
| `GET /properties` | `properties:list:*` | 5 min | Property listings with filters |
| `GET /properties/promoted` | `properties:promoted:*` | 5 min | Promoted properties |
| `GET /properties/:id` | `properties:detail:*` | 15 min | Individual property details |

### Cache Invalidation

**Automatic Invalidation:**
- Property creation → Invalidate all `properties:list:*` and `properties:promoted:*`
- Property update → Invalidate specific property + all lists
- Property deletion → Invalidate specific property + all lists

**Manual Invalidation:**
```typescript
// Service method
await this.cacheService.deleteByPattern('properties:list:*');
```

## Performance Monitoring

### Monitoring Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /monitoring/health` | System health check |
| `GET /monitoring/performance` | Performance statistics |
| `GET /monitoring/performance/raw` | Raw performance metrics |
| `GET /monitoring/cache/info` | Cache configuration info |
| `GET /monitoring/system` | System information |

### Key Metrics

**Response Time Targets:**
- P95 < 500ms
- P99 < 1000ms
- Average < 200ms

**Cache Performance:**
- Hit ratio > 80% for repeated requests
- Redis memory usage monitoring
- Cache invalidation frequency

## Load Testing

### Running Load Tests

1. **Start Redis:**
   ```bash
   redis-server
   ```

2. **Start Backend:**
   ```bash
   cd Nest/kwena-nestjs-supabase
   npm run start:dev
   ```

3. **Install Artillery (if not installed):**
   ```bash
   npm install -g artillery
   ```

4. **Run Load Tests:**
   ```bash
   ./load-test/run-load-tests.sh
   ```

### Test Scenarios

**Properties Load Test:**
- Simulates 1000 concurrent users
- Tests all property endpoints
- Various filter combinations
- Pagination stress testing

**Cache Performance Test:**
- Cache hit ratio validation
- Repeated request patterns
- Cache invalidation under load

## Troubleshooting

### Common Issues

**1. Redis Connection Error:**
```
Error: Redis connection failed
```
Solution: Ensure Redis is running and accessible at the configured URL.

**2. High Memory Usage:**
```
Redis memory usage exceeding limits
```
Solution: Adjust cache TTL values or implement cache size limits.

**3. Cache Miss Rate High:**
```
Cache hit ratio < 50%
```
Solution: Review cache key patterns and TTL settings.

### Redis Commands for Debugging

```bash
# Monitor Redis operations
redis-cli monitor

# Check memory usage
redis-cli info memory

# List all keys
redis-cli keys "*"

# Check specific key TTL
redis-cli ttl "properties:list:page:1"

# Clear all cache
redis-cli flushall
```

### Performance Monitoring

**Application Logs:**
```bash
# Check cache hit/miss rates
grep "Cache HIT\|Cache MISS" logs/application.log

# Monitor slow requests
grep "Slow request detected" logs/application.log
```

**Redis Stats:**
```bash
# Get Redis statistics
redis-cli info stats

# Monitor Redis performance
redis-cli --latency-history -i 1
```

## Production Considerations

### Redis Configuration
- Enable persistence (RDB + AOF)
- Configure memory policies
- Set up Redis Sentinel for high availability
- Monitor Redis memory usage

### Scaling
- Redis Cluster for horizontal scaling
- Read replicas for read-heavy workloads
- Cache warming strategies
- Circuit breaker patterns

### Security
- Enable Redis authentication
- Use TLS for Redis connections
- Network security (VPC, firewalls)
- Regular security updates

## Expected Performance Improvements

With Redis caching enabled:
- **Response Time**: 50-70% reduction for cached requests
- **Database Load**: 60-80% reduction in query volume
- **Concurrent Users**: Support for 1000+ users
- **Cache Hit Ratio**: 80-90% for typical usage patterns

## Monitoring Dashboard

Access real-time performance metrics:
- `http://localhost:3000/monitoring/performance` - Performance stats
- `http://localhost:3000/monitoring/health` - Health check
- Load test reports in `load-test/results/`

## Next Steps

1. **Production Deployment**: Configure Redis cluster and monitoring
2. **Cache Warming**: Implement cache pre-loading for popular data
3. **Advanced Patterns**: Circuit breakers, cache-aside patterns
4. **Monitoring**: Set up alerts for cache performance metrics