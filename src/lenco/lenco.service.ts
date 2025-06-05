import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

interface LencoSettlementDetails {
  id: string;
  amountSettled: string;
  currency: string;
  createdAt: string;
  settledAt: string | null;
  status: 'pending' | 'settled';
  type: 'instant' | 'next-day';
  accountId: string;
}

interface LencoMobileMoneyDetails {
  country: string;
  phone: string;
  operator: string;
  accountName: string | null;
}

interface LencoCardDetailsData {
  firstName: string | null;
  lastName: string | null;
  bin: string | null;
  last4: string | null;
  cardType: string | null;
}

interface LencoVerifyResponseData {
  id: string;
  initiatedAt: string;
  completedAt: string | null;
  amount: string;
  fee: string | null;
  bearer: 'merchant' | 'customer';
  currency: string;
  reference: string | null;
  lencoReference: string;
  type: 'card' | 'mobile-money' | 'bank-account' | null;
  status:
    | 'pending'
    | 'successful'
    | 'failed'
    | 'otp-required'
    | 'pay-offline';
  source: 'banking-app' | 'api';
  reasonForFailure: string | null;
  settlementStatus: 'pending' | 'settled' | null;
  settlement: LencoSettlementDetails | null;
  mobileMoneyDetails: LencoMobileMoneyDetails | null;
  bankAccountDetails: any | null;
  cardDetails: LencoCardDetailsData | null;
}

interface LencoVerifyResponse {
  status: boolean;
  message: string;
  data?: LencoVerifyResponseData;
}

interface LencoCollectionRequestBody {
  amount: number;
  reference: string;
  phone: string;
  operator: string;
  country?: string;
  bearer?: 'merchant' | 'customer';
}

interface LencoCollectionResponseData {
  id: string;
  reference: string;
  lencoReference: string;
  status: string;
  amount: string;
}

interface LencoCollectionResponse {
  status: boolean;
  message: string;
  data?: LencoCollectionResponseData;
}

interface LencoOtpSubmitBody {
  reference: string;
  otp: string;
}

interface LencoOtpSubmitResponseData {
  id: string;
  initiatedAt: string;
  completedAt: string | null;
  amount: string;
  fee: string | null;
  bearer: 'merchant' | 'customer';
  currency: string;
  reference: string;
  lencoReference: string;
  type: 'mobile-money';
  status:
    | 'pending'
    | 'successful'
    | 'failed'
    | 'otp-required'
    | 'pay-offline';
  source: 'api';
  reasonForFailure: string | null;
  settlementStatus: 'pending' | 'settled' | null;
  settlement: LencoSettlementDetails | null;
  mobileMoneyDetails: LencoMobileMoneyDetails | null;
}

interface LencoOtpSubmitResponse {
  status: boolean;
  message: string;
  data?: LencoOtpSubmitResponseData;
}

@Injectable()
export class LencoService {
  private readonly logger = new Logger(LencoService.name);
  private readonly secretKey: string;
  private readonly publicKey: string;
  private readonly baseUrl: string;
  private readonly verifyEndpointPrefix: string;
  private readonly collectionEndpoint = '/access/v2/collections/mobile-money';
  private readonly submitOtpEndpoint =
    '/access/v2/collections/mobile-money/submit-otp';

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService
      .getOrThrow<string>('LENCO_SECRET_KEY')
      .trim();
    this.publicKey = this.configService
      .getOrThrow<string>('LENCO_PUBLIC_KEY')
      .trim();
    this.baseUrl = this.configService
      .getOrThrow<string>('LENCO_API_BASE_URL')
      .trim();
    this.verifyEndpointPrefix = this.configService.getOrThrow<string>(
      'LENCO_VERIFY_ENDPOINT',
    );
  }

  async initiateMobileMoneyCollection(
    payload: LencoCollectionRequestBody,
  ): Promise<LencoCollectionResponseData> {
    const url = `${this.baseUrl}${this.collectionEndpoint}`;
    this.logger.log(
      `Initiating Lenco mobile money collection for ref: ${payload.reference}`,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const responseData: LencoCollectionResponse = await response.json();
      this.logger.debug(
        `Lenco collection response for ${payload.reference}: ${JSON.stringify(
          responseData,
        )}`,
      );

      if (!response.ok || !responseData.status || !responseData.data) {
        this.logger.error(
          `Lenco collection initiation failed for ${payload.reference}. Status: ${response.status}, Lenco Status: ${responseData.status}, Message: ${responseData.message}`,
        );
        throw new HttpException(
          responseData.message || 'Failed to initiate mobile money collection',
          response.status || HttpStatus.BAD_GATEWAY,
        );
      }
      return responseData.data;
    } catch (error) {
      this.logger.error(
        `Error calling Lenco collection API for reference ${payload.reference}: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `Failed to initiate collection with Lenco: ${error.message}`,
      );
    }
  }

  async submitOtp(
    reference: string,
    otp: string,
  ): Promise<LencoOtpSubmitResponseData> {
    const url = `${this.baseUrl}${this.submitOtpEndpoint}`;
    this.logger.log(`Submitting OTP for Lenco reference: ${reference}`);
    const payload: LencoOtpSubmitBody = { reference, otp };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const responseData: LencoOtpSubmitResponse = await response.json();
      this.logger.debug(
        `Lenco OTP submit response for ${reference}: ${JSON.stringify(
          responseData,
        )}`,
      );

      if (!response.ok || !responseData.status || !responseData.data) {
        this.logger.error(
          `Lenco OTP submission failed for ${reference}. Status: ${response.status}, Lenco Status: ${responseData.status}, Message: ${responseData.message}`,
        );
        throw new HttpException(
          responseData.message || 'Failed to submit OTP',
          response.status || HttpStatus.BAD_GATEWAY,
        );
      }
      return responseData.data;
    } catch (error) {
      this.logger.error(
        `Error calling Lenco OTP submit API for reference ${reference}: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `Failed to submit OTP to Lenco: ${error.message}`,
      );
    }
  }

  async verifyPayment(
    reference: string,
  ): Promise<LencoVerifyResponseData | null> {
    const fullVerifyEndpoint = this.verifyEndpointPrefix.endsWith('/')
      ? `${this.verifyEndpointPrefix}${reference}`
      : `${this.verifyEndpointPrefix}/${reference}`;
    const url = `${this.baseUrl}${fullVerifyEndpoint}`;

    this.logger.log(
      `Verifying Lenco payment for reference: ${reference} at ${url}`,
    );

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
      });
      const responseData: LencoVerifyResponse = await response.json();
      this.logger.debug(
        `Lenco verification response for ${reference}: ${JSON.stringify(
          responseData,
        )}`,
      );

      if (!response.ok || !responseData.status) {
        this.logger.warn(
          `Lenco verification issue or non-successful Lenco status for ${reference}. HTTP Status: ${response.status}, Lenco Status: ${responseData.status}, Message: ${responseData.message}`,
        );
        return responseData.data || null;
      }
      if (responseData.data) {
        return responseData.data;
      }
      this.logger.warn(
        `Lenco verification successful for ${reference} but no data returned.`,
      );
      return null;
    } catch (error) {
      this.logger.error(
        `Error calling Lenco verify API for reference ${reference}: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  public verifyWebhookSignature(
    rawBody: string | Buffer,
    signatureFromHeader: string,
    webhookHashKey: string,
  ): boolean {
    if (!signatureFromHeader) {
      this.logger.warn('Lenco webhook signature missing from header.');
      return false;
    }
    if (!webhookHashKey) {
      this.logger.error(
        'Lenco webhook hash key not provided for verification.',
      );
      return false;
    }
    if (rawBody === undefined || rawBody === null) {
      this.logger.warn(
        'Raw body not provided for Lenco webhook signature verification.',
      );
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha512', webhookHashKey);
      const computedSignature = hmac
        .update(rawBody.toString())
        .digest('hex');

      const sigBuffer = Buffer.from(signatureFromHeader, 'hex');
      const computedSigBuffer = Buffer.from(computedSignature, 'hex');

      if (sigBuffer.length !== computedSigBuffer.length) {
        this.logger.warn(
          `Lenco webhook signature length mismatch. Received length: ${sigBuffer.length}, Computed length: ${computedSigBuffer.length}. Received Sig: ${signatureFromHeader}, Computed Sig: ${computedSignature}`,
        );
        return false;
      }

      const isValid = crypto.timingSafeEqual(sigBuffer, computedSigBuffer);

      if (!isValid) {
        this.logger.warn(
          `Invalid Lenco webhook signature. Computed: ${computedSignature}, Received: ${signatureFromHeader}`,
        );
      }
      return isValid;
    } catch (error) {
      this.logger.error(
        'Error verifying Lenco webhook signature:',
        error.message,
        error.stack,
      );
      return false;
    }
  }
}