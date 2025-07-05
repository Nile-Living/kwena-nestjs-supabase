#!/bin/bash

# Load Testing Script for Kwena Properties Backend
# This script runs comprehensive load tests to validate caching performance

echo "🚀 Starting Kwena Properties Load Tests"
echo "========================================"

# Check if Artillery is installed
if ! command -v artillery &> /dev/null; then
    echo "❌ Artillery not found. Installing..."
    npm install -g artillery
fi

# Create results directory
mkdir -p load-test/results
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_DIR="load-test/results/$TIMESTAMP"
mkdir -p "$RESULTS_DIR"

echo "📊 Results will be saved to: $RESULTS_DIR"

# Function to run a test and save results
run_test() {
    local test_name=$1
    local test_file=$2
    local description=$3
    
    echo ""
    echo "🔥 Running $test_name"
    echo "Description: $description"
    echo "----------------------------------------"
    
    artillery run "$test_file" \
        --output "$RESULTS_DIR/${test_name}_raw.json" \
        | tee "$RESULTS_DIR/${test_name}_console.log"
    
    # Generate HTML report
    artillery report "$RESULTS_DIR/${test_name}_raw.json" \
        --output "$RESULTS_DIR/${test_name}_report.html"
    
    echo "✅ $test_name completed"
    echo "📈 Report: $RESULTS_DIR/${test_name}_report.html"
}

# Start the backend server (if not already running)
echo "🔍 Checking if backend is running..."
if ! curl -s http://localhost:3000/properties > /dev/null; then
    echo "⚠️  Backend not running. Please start it with: npm run start:dev"
    echo "   Make sure Redis is also running: redis-server"
    exit 1
fi

echo "✅ Backend is running"

# Test 1: Properties API Load Test
run_test "properties_load_test" \
         "load-test/properties-load-test.yml" \
         "Comprehensive load test for properties API with 1000 concurrent users"

# Wait a bit between tests
sleep 10

# Test 2: Cache Performance Test
run_test "cache_performance_test" \
         "load-test/cache-performance-test.yml" \
         "Cache hit ratio and performance validation test"

# Generate summary report
echo ""
echo "📋 Generating Summary Report"
echo "============================"

cat > "$RESULTS_DIR/test_summary.md" << EOF
# Load Test Summary - $(date)

## Test Environment
- Target: http://localhost:3000
- Test Duration: $(date)
- Results Directory: $RESULTS_DIR

## Tests Executed

### 1. Properties Load Test
- **Objective**: Test API performance under 1000 concurrent users
- **Phases**: Warm-up → Ramp-up → Peak Load → Cool-down
- **Endpoints Tested**: 
  - GET /properties (with various filters)
  - GET /properties/promoted
  - GET /properties/:id
- **Report**: [properties_load_test_report.html](./properties_load_test_report.html)

### 2. Cache Performance Test
- **Objective**: Validate Redis caching effectiveness
- **Focus**: Cache hit ratios and response times
- **Report**: [cache_performance_test_report.html](./cache_performance_test_report.html)

## Key Metrics to Review
1. **Response Times**: p95, p99 percentiles
2. **Throughput**: Requests per second
3. **Error Rate**: Should be < 1%
4. **Cache Hit Ratio**: Monitor via application logs
5. **Memory Usage**: Monitor Redis memory consumption

## Performance Targets
- ✅ p95 response time < 500ms
- ✅ p99 response time < 1000ms
- ✅ Error rate < 1%
- ✅ Successful handling of 1000 concurrent users
- ✅ Cache hit ratio > 80% for repeated requests

EOF

echo "✅ Summary report created: $RESULTS_DIR/test_summary.md"

echo ""
echo "🎉 All load tests completed successfully!"
echo "📂 Results location: $RESULTS_DIR"
echo ""
echo "🔍 To analyze results:"
echo "   1. Open HTML reports in browser"
echo "   2. Check application logs for cache performance"
echo "   3. Monitor Redis metrics: redis-cli info stats"
echo ""
echo "💡 Pro tip: Compare results with and without Redis to measure cache impact"