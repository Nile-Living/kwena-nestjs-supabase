# Kwena Properties Backend - NestJS & Supabase

## Overview

**Kwena Properties** is a comprehensive real estate platform backend built with NestJS and Supabase. The system supports property listings, user management, payments, subscriptions, notifications, and real-time features for a complete real estate marketplace.

## Architecture

### Technology Stack
- **Framework:** NestJS (Node.js)
- **Database:** Supabase (PostgreSQL)
- **Cache:** Redis with cache-manager
- **Authentication:** JWT with Passport
- **File Storage:** Cloudinary
- **Payment Processing:** Lenco & Zynle
- **API Documentation:** Built-in NestJS validation
- **Platform:** Fastify (HTTP server)

### Key Features
- Property management with advanced search and filtering
- User authentication and authorization (JWT)
- Subscription-based business model
- Payment processing with multiple providers
- Real-time notifications
- Advanced caching strategy (Redis)
- Image upload and management
- Property promotion system
- Comprehensive monitoring and performance tracking

## Project Structure

```
kwena-nestjs-supabase/
├── src/
│   ├── app.module.ts              # Main application module
│   ├── main.ts                    # Application bootstrap
│   ├── auth/                      # Authentication module
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── jwt.strategy.ts
│   │   └── guards/
│   ├── properties/                # Property management
│   │   ├── properties.controller.ts
│   │   ├── properties.service.ts
│   │   └── dto/
│   ├── users/                     # User management
│   │   └── saved-properties/
│   ├── payments/                  # Payment processing
│   │   ├── payments.controller.ts
│   │   ├── payments.service.ts
│   │   └── webhooks.controller.ts
│   ├── subscriptions/             # Subscription management
│   ├── notifications/             # Notification system
│   ├── profiles/                  # User profiles
│   ├── promotions/               # Property promotions
│   ├── cache/                    # Redis caching
│   ├── cloudinary/               # Image management
│   ├── supabase/                 # Database integration
│   ├── monitoring/               # Performance monitoring
│   ├── lenco/                    # Payment provider
│   └── zynle/                    # Payment provider
├── load-test/                    # Load testing configuration
├── test/                         # E2E tests
├── CACHING_SETUP.md             # Redis setup documentation
└── package.json
```

## Core Modules

### 1. Authentication Module (`/src/auth/`)
- **JWT-based authentication** with Passport strategy
- **User registration and login** with email/password
- **Role-based access control** (user, agent)
- **Supabase Auth integration** for user management
- **Guards and decorators** for protected routes

**Key Files:**
- `auth.service.ts` - Authentication logic
- `jwt.strategy.ts` - JWT validation strategy
- `guards/jwt-auth.guard.ts` - Route protection

### 2. Properties Module (`/src/properties/`)
- **Complex property management** with multiple property types
- **Advanced search and filtering** system
- **Property promotion** with ad injection
- **Image upload and management** via Cloudinary
- **Caching strategy** for performance optimization
- **Property categories:** House, Land, Apartment, Commercial

**Key Features:**
- Property CRUD operations
- Advanced search with location, price, amenities
- Property promotion system
- Image upload and management
- Real-time property updates

### 3. Supabase Module (`/src/supabase/`)
- **Dual client configuration:**
  - `SUPABASE_ANON_CLIENT` - For public operations (honors RLS)
  - `SUPABASE_SERVICE_ADMIN` - For admin operations (bypasses RLS)
- **Global module** available throughout the application
- **Environment-based configuration**

### 4. Cache Module (`/src/cache/`)
- **Redis-based caching** with cache-manager
- **Multi-level caching strategy:**
  - L1: API Response Caching (5-15 minutes)
  - L2: Database Query Caching (30 minutes)
  - L3: Static/Reference Data Caching (1-24 hours)
- **Intelligent cache invalidation**
- **Performance monitoring** and metrics

### 5. Payments Module (`/src/payments/`)
- **Multiple payment providers** (Lenco, Zynle)
- **Mobile money integration** (MTN, Airtel, Zamtel)
- **Subscription payment processing**
- **Webhook handling** for payment notifications
- **OTP verification** for secure payments

### 6. Subscriptions Module (`/src/subscriptions/`)
- **Subscription-based business model**
- **Multiple subscription tiers** (Basic, Premium)
- **Feature-based access control**
- **Payment integration** with auto-renewal
- **Subscription recovery** and management

### 7. Notifications Module (`/src/notifications/`)
- **Push notifications** with Expo SDK
- **Saved searches** with automated notifications
- **Real-time property alerts**
- **Device token management**
- **Notification history** and read status

## Database Schema

### Supabase/PostgreSQL Tables
- **`auth.users`** - User authentication (managed by Supabase)
- **`public.profiles`** - User profiles and metadata
- **`public.properties`** - Base property information
- **`public.property_details_*`** - Category-specific property details
- **`public.saved_properties`** - User saved properties
- **`public.subscriptions`** - User subscriptions
- **`public.notifications`** - User notifications
- **`public.saved_searches`** - User saved search criteria

### Database Views
- **`properties_view`** - Comprehensive property view with user details
- **Database triggers** for automatic profile creation
- **Row Level Security (RLS)** for data protection

## API Endpoints

### Authentication (`/auth`)
- `POST /auth/signin` - User login
- `POST /auth/signup` - User registration

### Properties (`/properties`)
- `GET /properties` - List properties with filtering (cached)
- `GET /properties/promoted` - Get promoted properties (cached)
- `GET /properties/:id` - Get property details (cached)
- `POST /properties` - Create property (authenticated)
- `PUT /properties/:id` - Update property (authenticated)
- `DELETE /properties/:id` - Delete property (authenticated)

### User Management
- `GET /profiles/me` - Get user profile (authenticated)
- `PATCH /profiles/me` - Update profile (authenticated)
- `GET /users/me/saved-properties` - Get saved properties (authenticated)
- `POST /users/me/saved-properties` - Save property (authenticated)

### Payments (`/payments`)
- `POST /payments/initiate` - Initiate payment (authenticated)
- `POST /payments/submit-otp` - Submit OTP (authenticated)
- `POST /payments/verify/:reference` - Verify payment (authenticated)

### Subscriptions (`/subscriptions`)
- `GET /subscriptions/plans` - Get subscription plans
- `POST /subscriptions` - Create subscription
- `GET /subscriptions/active` - Get active subscription
- `GET /subscriptions/status` - Get subscription status

### Notifications (`/notifications`)
- `GET /notifications` - Get user notifications
- `PUT /notifications/:id/read` - Mark as read
- `POST /notifications/device-token` - Register device token

### Monitoring (`/monitoring`)
- `GET /monitoring/health` - Health check
- `GET /monitoring/performance` - Performance metrics
- `GET /monitoring/cache/info` - Cache information

## Performance & Caching

### Redis Caching Strategy
- **Multi-level caching** for optimal performance
- **TTL Configuration:**
  - Properties list: 5 minutes
  - Property details: 15 minutes
  - User data: 10 minutes
  - Static data: 1 hour
  - Ad tracking: 24 hours
- **Cache invalidation** on data changes
- **Performance monitoring** with detailed metrics

### Load Testing
- **Artillery-based** load testing
- **1000+ concurrent users** support
- **Comprehensive test scenarios**
- **Performance monitoring** during load

## Development Setup

### Prerequisites
- Node.js (v16+)
- Redis server
- Supabase project
- Cloudinary account

### Environment Variables
```env
# Database
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Cache
REDIS_URL=redis://localhost:6379

# File Storage
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Payment Providers
LENCO_API_KEY=your_lenco_key
ZYNLE_API_KEY=your_zynle_key

# JWT
JWT_SECRET=your_jwt_secret
```

### Installation & Running
```bash
# Install dependencies
npm install

# Start development server
npm run start:dev

# Run tests
npm run test

# Run load tests
./load-test/run-load-tests.sh
```

## Deployment

### Production Considerations
- **Redis clustering** for high availability
- **Supabase RLS** for data security
- **Environment-based configuration**
- **Monitoring and alerting**
- **Load balancing** for multiple instances

### Performance Targets
- **Response Time:** P95 < 500ms, P99 < 1000ms
- **Cache Hit Ratio:** > 80%
- **Concurrent Users:** 1000+
- **Database Load:** 60-80% reduction with caching

## Security

### Authentication & Authorization
- **JWT tokens** for session management
- **Role-based access control**
- **Supabase RLS** for database security
- **Input validation** with class-validator
- **CORS configuration** for cross-origin requests

### Data Protection
- **Environment variables** for sensitive data
- **Webhook signature verification**
- **Input sanitization**
- **Rate limiting** considerations

## Monitoring

### Built-in Monitoring
- **Health checks** for system status
- **Performance metrics** collection
- **Cache performance** monitoring
- **System resource** tracking

### Logging
- **Structured logging** with NestJS Logger
- **Request/response logging**
- **Error tracking** and reporting
- **Performance monitoring**

## Testing

### Test Structure
- **Unit tests** for services
- **Integration tests** for controllers
- **E2E tests** for complete workflows
- **Load tests** for performance validation

### Load Testing
- **Artillery-based** load testing
- **Multiple test scenarios**
- **Performance benchmarking**
- **Stress testing** capabilities

## Business Logic

### Property Management
- **Multi-category support** (House, Land, Apartment, Commercial)
- **Advanced search** with location, price, amenities
- **Property promotion** system with ad injection
- **Image management** with Cloudinary

### Subscription Model
- **Tiered subscriptions** (Basic, Premium)
- **Feature-based access control**
- **Payment integration** with multiple providers
- **Automatic renewal** and management

### Notification System
- **Push notifications** for property alerts
- **Saved searches** with automatic notifications
- **Device token management**
- **Real-time property updates**

## Integration Points

### External Services
- **Supabase:** Database and authentication
- **Redis:** Caching and performance
- **Cloudinary:** Image storage and management
- **Lenco/Zynle:** Payment processing
- **Expo:** Push notifications

### API Integrations
- **RESTful APIs** for all operations
- **Webhook support** for real-time updates
- **JWT authentication** for secure access
- **File upload** support for images

## Development Commands

```bash
# Development
npm run start:dev          # Start development server
npm run build             # Build for production
npm run start:prod        # Start production server

# Testing
npm run test              # Run unit tests
npm run test:e2e          # Run E2E tests
npm run test:cov          # Run tests with coverage

# Code Quality
npm run lint              # Run ESLint
npm run format            # Format code with Prettier

# Load Testing
./load-test/run-load-tests.sh  # Run load tests
```

## Future Enhancements

### Planned Features
- **WebSocket integration** for real-time updates
- **Advanced analytics** and reporting
- **Multi-language support**
- **Mobile app integration**
- **AI-powered property recommendations**

### Technical Improvements
- **GraphQL integration** for flexible querying
- **Microservices architecture** for scalability
- **Advanced caching** with CDN integration
- **Enhanced monitoring** with APM tools

---

This backend provides a solid foundation for a comprehensive real estate platform with robust authentication, efficient caching, secure payments, and scalable architecture designed to handle high traffic loads while maintaining excellent performance.