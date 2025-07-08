import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { LencoService } from '../lenco/lenco.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentProvider } from './enums/payment-provider.enums';
import { PaymentMethod } from './dto/initiate-payment.dto';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let lencoService: jest.Mocked<LencoService>;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;
  let configService: jest.Mocked<ConfigService>;

  const mockLencoService = {
    initiateMobileMoneyCollection: jest.fn(),
    submitOtp: jest.fn(),
    verifyPayment: jest.fn(),
  };

  const mockSubscriptionsService = {
    createSubscription: jest.fn(),
    getSubscriptionByPaymentReference: jest.fn(),
    getUserActiveSubscription: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockSupabaseClient = {
    from: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: LencoService,
          useValue: mockLencoService,
        },
        {
          provide: SubscriptionsService,
          useValue: mockSubscriptionsService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: 'SUPABASE_ANON_CLIENT',
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    lencoService = module.get(LencoService);
    subscriptionsService = module.get(SubscriptionsService);
    configService = module.get(ConfigService);

    // Setup default config mock
    mockConfigService.get.mockReturnValue(PaymentProvider.LENCO);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initiatePayment', () => {
    const userId = 'test-user-id';
    const mockPaymentDto = {
      amount: 100,
      phone: '0971234567',
      method: PaymentMethod.MOMO,
      operator: 'mtn',
    };

    it('should successfully initiate payment with Lenco', async () => {
      const mockLencoResponse = {
        reference: 'SUB_test-user-id_1234567890',
        lencoReference: 'lenco-ref-123',
        status: 'initiated',
      };

      mockLencoService.initiateMobileMoneyCollection.mockResolvedValue(mockLencoResponse);

      const result = await service.initiatePayment(userId, mockPaymentDto);

      expect(result).toEqual({
        provider: PaymentProvider.LENCO,
        reference: mockLencoResponse.reference,
        lencoReference: mockLencoResponse.lencoReference,
        status: mockLencoResponse.status,
        message: `Payment initiated with Lenco. Status: ${mockLencoResponse.status}`,
        requiresOtp: false,
      });

      expect(mockLencoService.initiateMobileMoneyCollection).toHaveBeenCalledWith({
        amount: mockPaymentDto.amount,
        reference: expect.stringMatching(/^SUB_test-user-id_\d+$/),
        phone: mockPaymentDto.phone,
        operator: mockPaymentDto.operator,
        country: 'ZM',
        bearer: 'customer',
      });
    });

    it('should reject card payments', async () => {
      const cardPaymentDto = {
        ...mockPaymentDto,
        method: PaymentMethod.CARD,
      };

      await expect(service.initiatePayment(userId, cardPaymentDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should handle OTP required status', async () => {
      const mockLencoResponse = {
        reference: 'SUB_test-user-id_1234567890',
        lencoReference: 'lenco-ref-123',
        status: 'otp-required',
      };

      mockLencoService.initiateMobileMoneyCollection.mockResolvedValue(mockLencoResponse);

      const result = await service.initiatePayment(userId, mockPaymentDto);

      expect(result.requiresOtp).toBe(true);
      expect(result.status).toBe('otp-required');
    });

    it('should handle Lenco errors gracefully', async () => {
      mockLencoService.initiateMobileMoneyCollection.mockRejectedValue(
        new Error('Lenco API error'),
      );

      await expect(service.initiatePayment(userId, mockPaymentDto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('submitOtp', () => {
    const userId = 'test-user-id';
    const mockOtpDto = {
      reference: 'SUB_test-user-id_1234567890',
      otp: '123456',
    };

    it('should successfully submit OTP and verify payment', async () => {
      const mockVerificationResult = {
        status: 'successful',
        reference: mockOtpDto.reference,
        lencoReference: 'lenco-ref-123',
        amount: '100',
      };

      mockLencoService.submitOtp.mockResolvedValue(undefined);
      mockLencoService.verifyPayment.mockResolvedValue(mockVerificationResult);
      mockSubscriptionsService.createSubscription.mockResolvedValue({
        id: 'sub-123',
        user_id: userId,
        subscription_type: 'basic',
        status: 'active',
      } as any);

      const result = await service.submitOtp(userId, mockOtpDto);

      expect(result).toEqual({
        provider: PaymentProvider.LENCO,
        status: mockVerificationResult.status,
        reference: mockVerificationResult.reference,
        lencoReference: mockVerificationResult.lencoReference,
        amount: mockVerificationResult.amount,
        message: `Lenco payment status after OTP: ${mockVerificationResult.status}`,
        subscriptionCreated: true,
      });

      expect(mockLencoService.submitOtp).toHaveBeenCalledWith(
        mockOtpDto.reference,
        mockOtpDto.otp,
      );
      expect(mockLencoService.verifyPayment).toHaveBeenCalledWith(mockOtpDto.reference);
      expect(mockSubscriptionsService.createSubscription).toHaveBeenCalled();
    });

    it('should handle OTP submission failure', async () => {
      mockLencoService.submitOtp.mockRejectedValue(new Error('Invalid OTP'));

      await expect(service.submitOtp(userId, mockOtpDto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('verifyPayment', () => {
    const userId = 'test-user-id';
    const reference = 'SUB_test-user-id_1234567890';

    it('should successfully verify payment and create subscription', async () => {
      const mockVerificationResult = {
        status: 'successful',
        reference: reference,
        lencoReference: 'lenco-ref-123',
        amount: '100',
        currency: 'ZMW',
        fee: '5',
        settlementStatus: 'settled',
      };

      mockLencoService.verifyPayment.mockResolvedValue(mockVerificationResult);
      mockSubscriptionsService.getSubscriptionByPaymentReference.mockResolvedValue(null);
      mockSubscriptionsService.getUserActiveSubscription.mockResolvedValue(null);
      mockSubscriptionsService.createSubscription.mockResolvedValue({
        id: 'sub-123',
        user_id: userId,
        subscription_type: 'basic',
        status: 'active',
      } as any);

      const result = await service.verifyPayment(userId, reference);

      expect(result).toEqual({
        provider: PaymentProvider.LENCO,
        status: mockVerificationResult.status,
        reference: mockVerificationResult.reference,
        lencoReference: mockVerificationResult.lencoReference,
        amount: mockVerificationResult.amount,
        currency: mockVerificationResult.currency,
        fee: mockVerificationResult.fee,
        settlementStatus: mockVerificationResult.settlementStatus,
        message: `Lenco payment status: ${mockVerificationResult.status}`,
      });

      expect(mockSubscriptionsService.createSubscription).toHaveBeenCalled();
    });

    it('should handle payment verification failure', async () => {
      mockLencoService.verifyPayment.mockResolvedValue(null);

      await expect(service.verifyPayment(userId, reference)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getCurrentProvider', () => {
    it('should return Lenco as current provider', () => {
      const result = service.getCurrentProvider();
      expect(result).toBe(PaymentProvider.LENCO);
    });
  });

  describe('ensureSubscriptionExists', () => {
    it('should skip creation if subscription already exists', async () => {
      const userId = 'test-user-id';
      const paymentReference = 'SUB_test-user-id_1234567890';
      const existingSubscription = {
        id: 'sub-123',
        status: 'active',
        payment_reference: paymentReference,
      };

      mockSubscriptionsService.getSubscriptionByPaymentReference.mockResolvedValue(
        existingSubscription as any,
      );

      // Use reflection to access private method for testing
      const ensureSubscriptionExists = (service as any).ensureSubscriptionExists.bind(service);
      await ensureSubscriptionExists(userId, paymentReference, 100);

      expect(mockSubscriptionsService.createSubscription).not.toHaveBeenCalled();
    });
  });
});