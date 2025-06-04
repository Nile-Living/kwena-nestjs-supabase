import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// --- Detailed Interfaces for Lenco API Responses ---

// For /collections/status/:reference -> data.settlement
interface LencoSettlementDetails {
  id: string;
  amountSettled: string;
  currency: string;
  createdAt: string; // date-time
  settledAt: string | null; // date-time | null
  status: 'pending' | 'settled';
  type: 'instant' | 'next-day';
  accountId: string;
}

// For /collections/status/:reference -> data.mobileMoneyDetails
interface LencoMobileMoneyDetails {
  country: string;
  phone: string;
  operator: string;
  accountName: string | null;
}

// For /collections/status/:reference -> data.cardDetails
interface LencoCardDetailsData {
  firstName: string | null;
  lastName: string | null;
  bin: string | null;
  last4: string | null;
  cardType: string | null;
}

// Updated interface for the 'data' object from /collections/status/:reference
interface LencoVerifyResponseData {
  id: string;
  initiatedAt: string; // date-time
  completedAt: string | null; // date-time | null
  amount: string;
  fee: string | null;
  bearer: 'merchant' | 'customer';
  currency: string;
  reference: string | null; // This is your original reference
  lencoReference: string; // This is Lenco's transaction reference
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
  bankAccountDetails: any | null; // Define more strictly if structure is known
  cardDetails: LencoCardDetailsData | null;
}

// General Lenco API response structure
interface LencoVerifyResponse {
  status: boolean;
  message: string;
  data?: LencoVerifyResponseData; // data object is of the detailed type
  // meta?: any; // if your API wrapper includes meta at this level
}

// --- Interfaces for Collection Initiation ---
interface LencoCollectionRequestBody {
  amount: number;
  reference: string;
  phone: string;
  operator: string;
  country?: string;
  bearer?: 'merchant' | 'customer';
}

// Interface for the 'data' object from /collections/mobile-money (initiation)
interface LencoCollectionResponseData {
  id: string; // Usually the Lenco Transaction ID
  reference: string; // Your original reference
  lencoReference: string; // Lenco's transaction reference
  status: string; // e.g., "pending", "otp-required", "pay-offline"
  amount: string; // Amount requested
  // Add other fields if present in the initiation response data
  // For example, Lenco docs show 'type', 'source', 'currency', 'bearer' etc.
  // For mobile money initiation, the response schema is similar to the verify schema but might have fewer fields initially.
  // The key is that `lencoReference` and `status` are present.
}

interface LencoCollectionResponse {
  status: boolean;
  message: string;
  data?: LencoCollectionResponseData;
}

// --- Interfaces for OTP Submission ---
interface LencoOtpSubmitBody {
  reference: string;
  otp: string;
}

// Interface for the 'data' object from /collections/mobile-money/submit-otp
interface LencoOtpSubmitResponseData {
  // This response is also similar to the collection/verify response structure
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
    | 'pay-offline'; // After OTP, status might change
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
  private readonly verifyEndpointPrefix: string; // Changed from verifyEndpoint
  private readonly collectionEndpoint = '/access/v2/collections/mobile-money';
  private readonly submitOtpEndpoint =
    '/access/v2/collections/mobile-money/submit-otp'; 

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.getOrThrow<string>('LENCO_SECRET_KEY').trim();
    this.publicKey = this.configService.getOrThrow<string>('LENCO_PUBLIC_KEY').trim();
    this.baseUrl = this.configService.getOrThrow<string>('LENCO_API_BASE_URL').trim();
    // Assuming LENCO_VERIFY_ENDPOINT in .env is like '/access/v2/collections/status/'
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
      // The 'data' object from OTP submit should also conform to a detailed structure
      // For now, LencoOtpSubmitResponseData is a placeholder, update it based on actual Lenco response.
      // It's likely very similar to LencoVerifyResponseData or LencoCollectionResponseData.
      // For safety, let's assume it's similar to LencoVerifyResponseData for now.
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
    // Ensure verifyEndpointPrefix ends with a slash if it doesn't already
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
        // If response is not ok OR Lenco status is false, but data might still exist (e.g. for a 'failed' transaction)
        this.logger.warn(
          `Lenco verification issue or non-successful Lenco status for ${reference}. HTTP Status: ${response.status}, Lenco Status: ${responseData.status}, Message: ${responseData.message}`,
        );
        // Return data if it exists, even if Lenco status is false, so PaymentsService can see the actual Lenco status.
        return responseData.data || null;
      }
      // If response.ok and responseData.status is true, and data exists
      if (responseData.data) {
        return responseData.data;
      }
      // If response.ok and responseData.status is true, but no data (unlikely for this endpoint)
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
}