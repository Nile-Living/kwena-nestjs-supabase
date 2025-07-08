import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { CacheService } from '../cache/cache.service';
import { EventType } from './dto/track-event.dto';
import { AnalyticsTimeRange } from './dto/analytics-query.dto';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let cacheService: jest.Mocked<CacheService>;

  const mockSupabaseClient = {
    from: jest.fn(),
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    deleteByPattern: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: 'SUPABASE_SERVICE_ADMIN',
          useValue: mockSupabaseClient,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    cacheService = module.get(CacheService);

    // Setup default mocks
    mockSupabaseClient.from.mockReturnValue({
      insert: jest.fn().mockReturnValue({ error: null }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockReturnValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('trackEvent', () => {
    const userId = 'test-user-id';
    const eventDto = {
      event_type: EventType.PROPERTY_VIEW,
      property_id: 'property-123',
      metadata: { source: 'search' },
    };

    it('should track event successfully', async () => {
      const mockInsert = jest.fn().mockReturnValue({ error: null });
      mockSupabaseClient.from.mockReturnValue({
        insert: mockInsert,
      });

      await service.trackEvent(userId, eventDto);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('user_analytics');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: userId,
          event_type: eventDto.event_type,
          property_id: eventDto.property_id,
          metadata: eventDto.metadata,
          created_at: expect.any(String),
        }),
      );
    });

    it('should handle database errors gracefully', async () => {
      const mockInsert = jest.fn().mockReturnValue({ 
        error: { message: 'Database error' } 
      });
      mockSupabaseClient.from.mockReturnValue({
        insert: mockInsert,
      });

      // Should not throw error to avoid disrupting user experience
      await expect(service.trackEvent(userId, eventDto)).resolves.not.toThrow();
    });

    it('should invalidate relevant caches', async () => {
      const mockInsert = jest.fn().mockReturnValue({ error: null });
      mockSupabaseClient.from.mockReturnValue({
        insert: mockInsert,
      });

      await service.trackEvent(userId, eventDto);

      expect(cacheService.deleteByPattern).toHaveBeenCalledWith(
        `user-engagement:${userId}:*`,
      );
      expect(cacheService.deleteByPattern).toHaveBeenCalledWith(
        `property-stats:${eventDto.property_id}:*`,
      );
    });
  });

  describe('getUserEngagementStats', () => {
    const userId = 'test-user-id';
    const query = { time_range: AnalyticsTimeRange.LAST_30_DAYS };

    it('should return cached stats if available', async () => {
      const cachedStats = {
        total_views: 10,
        total_saves: 5,
        total_contacts: 2,
        total_searches: 8,
        unique_properties_viewed: 7,
        avg_session_duration: 0,
      };

      cacheService.get.mockResolvedValue(cachedStats);

      const result = await service.getUserEngagementStats(userId, query);

      expect(result).toEqual(cachedStats);
      expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    });

    it('should fetch and calculate stats from database', async () => {
      cacheService.get.mockResolvedValue(null);

      const mockEvents = [
        { event_type: EventType.PROPERTY_VIEW, property_id: 'prop1' },
        { event_type: EventType.PROPERTY_VIEW, property_id: 'prop2' },
        { event_type: EventType.PROPERTY_SAVE, property_id: 'prop1' },
        { event_type: EventType.SEARCH_PERFORMED },
      ];

      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockReturnValue({
              data: mockEvents,
              error: null,
            }),
          }),
        }),
      });

      mockSupabaseClient.from.mockReturnValue({
        select: mockSelect,
      });

      const result = await service.getUserEngagementStats(userId, query);

      expect(result).toEqual({
        total_views: 2,
        total_saves: 1,
        total_contacts: 0,
        total_searches: 1,
        unique_properties_viewed: 2,
        avg_session_duration: 0,
      });

      expect(cacheService.set).toHaveBeenCalledWith(
        expect.stringContaining('user-engagement'),
        result,
        3600,
      );
    });

    it('should handle database errors', async () => {
      cacheService.get.mockResolvedValue(null);

      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockReturnValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }),
        }),
      });

      mockSupabaseClient.from.mockReturnValue({
        select: mockSelect,
      });

      await expect(
        service.getUserEngagementStats(userId, query),
      ).rejects.toThrow('Failed to get user engagement stats');
    });
  });

  describe('getPropertyStats', () => {
    const propertyId = 'property-123';
    const query = { time_range: AnalyticsTimeRange.LAST_30_DAYS };

    it('should return cached property stats if available', async () => {
      const cachedStats = {
        property_id: propertyId,
        total_views: 15,
        total_saves: 3,
        total_contacts: 1,
        total_shares: 2,
        last_viewed: '2025-01-06T10:00:00Z',
      };

      cacheService.get.mockResolvedValue(cachedStats);

      const result = await service.getPropertyStats(propertyId, query);

      expect(result).toEqual(cachedStats);
    });

    it('should calculate property stats from database', async () => {
      cacheService.get.mockResolvedValue(null);

      const mockEvents = [
        { event_type: EventType.PROPERTY_VIEW, created_at: '2025-01-06T10:00:00Z' },
        { event_type: EventType.PROPERTY_VIEW, created_at: '2025-01-05T10:00:00Z' },
        { event_type: EventType.PROPERTY_SAVE, created_at: '2025-01-04T10:00:00Z' },
        { event_type: EventType.PROPERTY_CONTACT, created_at: '2025-01-03T10:00:00Z' },
      ];

      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockReturnValue({
              data: mockEvents,
              error: null,
            }),
          }),
        }),
      });

      mockSupabaseClient.from.mockReturnValue({
        select: mockSelect,
      });

      const result = await service.getPropertyStats(propertyId, query);

      expect(result).toEqual({
        property_id: propertyId,
        total_views: 2,
        total_saves: 1,
        total_contacts: 1,
        total_shares: 0,
        last_viewed: '2025-01-06T10:00:00Z',
      });
    });
  });

  describe('getSubscriptionStats', () => {
    it('should return cached subscription stats if available', async () => {
      const cachedStats = {
        total_users: 100,
        premium_users: 15,
        conversion_rate: 15,
        recent_upgrades: 5,
      };

      cacheService.get.mockResolvedValue(cachedStats);

      const result = await service.getSubscriptionStats();

      expect(result).toEqual(cachedStats);
    });

    it('should calculate subscription stats from database', async () => {
      cacheService.get.mockResolvedValue(null);

      // Mock total users query
      const mockTotalUsersQuery = {
        select: jest.fn().mockReturnValue({
          data: null,
          error: null,
          count: 150,
        }),
      };

      // Mock premium users query
      const mockPremiumUsersQuery = {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              data: null,
              error: null,
              count: 20,
            }),
          }),
        }),
      };

      // Mock recent upgrades query
      const mockRecentUpgradesQuery = {
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            data: null,
            error: null,
            count: 8,
          }),
        }),
      };

      mockSupabaseClient.from
        .mockReturnValueOnce(mockTotalUsersQuery)
        .mockReturnValueOnce(mockPremiumUsersQuery)
        .mockReturnValueOnce(mockRecentUpgradesQuery);

      const result = await service.getSubscriptionStats();

      expect(result).toEqual({
        total_users: 150,
        premium_users: 20,
        conversion_rate: (20 / 150) * 100,
        recent_upgrades: 8,
      });

      expect(cacheService.set).toHaveBeenCalledWith(
        'subscription-stats',
        result,
        3600,
      );
    });
  });

  describe('getTopProperties', () => {
    it('should return cached top properties if available', async () => {
      const cachedTopProperties = [
        { property_id: 'prop1', total_views: 100 },
        { property_id: 'prop2', total_views: 90 },
      ];

      cacheService.get.mockResolvedValue(cachedTopProperties);

      const result = await service.getTopProperties(2);

      expect(result).toEqual(cachedTopProperties);
    });

    it('should calculate top properties from database', async () => {
      cacheService.get.mockResolvedValue(null);

      const mockViewEvents = [
        { property_id: 'prop1' },
        { property_id: 'prop1' },
        { property_id: 'prop2' },
        { property_id: 'prop3' },
        { property_id: 'prop1' },
      ];

      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              data: mockViewEvents,
              error: null,
            }),
          }),
        }),
      });

      mockSupabaseClient.from.mockReturnValue({
        select: mockSelect,
      });

      // Mock getPropertyStats for top properties
      jest.spyOn(service, 'getPropertyStats')
        .mockResolvedValueOnce({
          property_id: 'prop1',
          total_views: 3,
          total_saves: 0,
          total_contacts: 0,
          total_shares: 0,
          last_viewed: '2025-01-06T10:00:00Z',
        })
        .mockResolvedValueOnce({
          property_id: 'prop2',
          total_views: 1,
          total_saves: 0,
          total_contacts: 0,
          total_shares: 0,
          last_viewed: '2025-01-06T09:00:00Z',
        });

      const result = await service.getTopProperties(2);

      expect(result).toHaveLength(2);
      expect(result[0].property_id).toBe('prop1');
      expect(result[1].property_id).toBe('prop2');
    });
  });
});