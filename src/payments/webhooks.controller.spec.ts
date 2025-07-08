import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { LencoService } from '../lenco/lenco.service';
import { PromotionsService } from '../promotions/promotions.service';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;
  let lencoService: jest.Mocked<LencoService>;
  let promotionsService: jest.Mocked<PromotionsService>;

  const mockSubscriptionsService = {
    getSubscriptionByPaymentReference: jest.fn(),
    createSubscription: jest.fn(),
  };

  const mockLencoService = {
    verifyWebhookSignature: jest.fn(),
  };

  const mockPromotionsService = {
    handleLencoWebhook: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        {
          provide: SubscriptionsService,
          useValue: mockSubscriptionsService,
        },
        {
          provide: LencoService,
          useValue: mockLencoService,
        },
        {
          provide: PromotionsService,
          useValue: mockPromotionsService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
    subscriptionsService = module.get(SubscriptionsService);
    lencoService = module.get(LencoService);
    promotionsService = module.get(PromotionsService);

    // Setup default config mock
    mockConfigService.get.mockReturnValue('test-signature-key');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleLencoCallback', () => {
    const mockRequest = {
      rawBodyString: '{"event":"collection.successful","data":{"reference":"SUB_user123_1234567890","status":"successful","amount":"100"}}',
    } as any;

    const mockCallbackData = {
      event: 'collection.successful',
      data: {
        reference: 'SUB_user123_1234567890',
        status: 'successful',
        amount: '100',
      },
    };

    it('should process subscription webhook successfully', async () => {
      mockLencoService.verifyWebhookSignature.mockReturnValue(true);
      mockSubscriptionsService.getSubscriptionByPaymentReference.mockResolvedValue(null);
      mockSubscriptionsService.createSubscription.mockResolvedValue({
        id: 'sub-123',
        user_id: 'user123',
        subscription_type: 'basic',
        status: 'active',
      } as any);

      const result = await controller.handleLencoCallback(
        mockRequest,
        mockCallbackData,
        'valid-signature',
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Lenco callback processed',
      });

      expect(mockSubscriptionsService.createSubscription).toHaveBeenCalledWith(
        'user123',
        {
          subscription_type: 'basic',
          duration_months: 1,
          payment_reference: 'SUB_user123_1234567890',
          amount_paid: 100,
          currency: 'ZMW',
        },
      );
    });

    it('should process promotion webhook successfully', async () => {
      const promotionCallbackData = {
        event: 'collection.successful',
        data: {
          reference: 'PROMO-uuid-123',
          status: 'successful',
          amount: '15',
        },
      };

      mockLencoService.verifyWebhookSignature.mockReturnValue(true);
      mockPromotionsService.handleLencoWebhook.mockResolvedValue(undefined);

      const result = await controller.handleLencoCallback(
        mockRequest,
        promotionCallbackData,
        'valid-signature',
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Lenco callback processed',
      });

      expect(mockPromotionsService.handleLencoWebhook).toHaveBeenCalledWith(
        promotionCallbackData,
      );
    });

    it('should reject invalid signature', async () => {
      mockLencoService.verifyWebhookSignature.mockReturnValue(false);

      await expect(
        controller.handleLencoCallback(mockRequest, mockCallbackData, 'invalid-signature'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject webhook with missing data', async () => {
      const invalidCallbackData = {
        event: 'collection.successful',
        data: {
          // Missing required fields
        },
      };

      mockLencoService.verifyWebhookSignature.mockReturnValue(true);

      const result = await controller.handleLencoCallback(
        mockRequest,
        invalidCallbackData,
        'valid-signature',
      );

      expect(result).toEqual({
        status: 'error',
        message: 'Missing critical data',
      });
    });

    it('should handle unknown reference prefix gracefully', async () => {
      const unknownCallbackData = {
        event: 'collection.successful',
        data: {
          reference: 'UNKNOWN_prefix_123',
          status: 'successful',
          amount: '100',
        },
      };

      mockLencoService.verifyWebhookSignature.mockReturnValue(true);

      const result = await controller.handleLencoCallback(
        mockRequest,
        unknownCallbackData,
        'valid-signature',
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Lenco callback processed',
      });

      // Should not call any handlers for unknown prefix
      expect(mockSubscriptionsService.createSubscription).not.toHaveBeenCalled();
      expect(mockPromotionsService.handleLencoWebhook).not.toHaveBeenCalled();
    });

    it('should handle subscription creation errors gracefully', async () => {
      mockLencoService.verifyWebhookSignature.mockReturnValue(true);
      mockSubscriptionsService.getSubscriptionByPaymentReference.mockResolvedValue(null);
      mockSubscriptionsService.createSubscription.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw, but handle the error internally
      const result = await controller.handleLencoCallback(
        mockRequest,
        mockCallbackData,
        'valid-signature',
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Lenco callback processed',
      });
    });

    it('should skip subscription creation if already exists', async () => {
      const existingSubscription = {
        id: 'sub-123',
        status: 'active',
        payment_reference: 'SUB_user123_1234567890',
      };

      mockLencoService.verifyWebhookSignature.mockReturnValue(true);
      mockSubscriptionsService.getSubscriptionByPaymentReference.mockResolvedValue(
        existingSubscription as any,
      );

      const result = await controller.handleLencoCallback(
        mockRequest,
        mockCallbackData,
        'valid-signature',
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Lenco callback processed',
      });

      expect(mockSubscriptionsService.createSubscription).not.toHaveBeenCalled();
    });

    it('should handle missing raw body string', async () => {
      const requestWithoutRawBody = {} as any;

      await expect(
        controller.handleLencoCallback(
          requestWithoutRawBody,
          mockCallbackData,
          'valid-signature',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});