import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// --- Interfaces (Keep existing ones) ---
interface LencoVerifyResponseData {
  id: string;
  reference: string;
  lencoReference: string;
  status: string;
  amount: string;
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
// --- New Interfaces for OTP ---
interface LencoOtpSubmitBody {
  reference: string;
  otp: string;
}
interface LencoOtpSubmitResponseData {
  // Define based on actual Lenco response for OTP submit
  // Might be similar to collection response or simpler
  status: string; // e.g., 'pending', 'pay-offline' after OTP
  reference: string;
  lencoReference?: string;
}
interface LencoOtpSubmitResponse {
  status: boolean;
  message: string;
  data?: LencoOtpSubmitResponseData;
}
// --- End New Interfaces ---

@Injectable()
export class LencoService {
  private readonly logger = new Logger(LencoService.name);
  private readonly secretKey: string;
  private readonly publicKey: string;
  private readonly baseUrl: string;
  private readonly verifyEndpoint: string;
  private readonly collectionEndpoint = '/access/v2/collections/mobile-money';
  private readonly submitOtpEndpoint =
    '/access/v2/collections/mobile-money/submit-otp'; // Added OTP endpoint

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.getOrThrow<string>('LENCO_SECRET_KEY').trim();
    this.publicKey = this.configService.getOrThrow<string>('LENCO_PUBLIC_KEY').trim();
    this.baseUrl = this.configService.getOrThrow<string>('LENCO_API_BASE_URL').trim();
    this.verifyEndpoint = this.configService.getOrThrow<string>(
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
    const url = `${this.baseUrl}${this.verifyEndpoint}${reference}`;
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

      if (!response.ok || !responseData.status || !responseData.data) {
        this.logger.warn(
          `Lenco verification failed or data missing for ${reference}. Status: ${response.status}, Lenco Status: ${responseData.status}, Message: ${responseData.message}`,
        );
        // Don't return null if status is false but data exists (e.g., failed status)
        return responseData.data || null;
      }
      return responseData.data;
    } catch (error) {
      this.logger.error(
        `Error calling Lenco verify API for reference ${reference}: ${error.message}`,
        error.stack,
      );
      // Don't throw here, return null to indicate verification couldn't complete
      return null;
      // throw new Error(`Failed to verify payment with Lenco: ${error.message}`);
    }
  }
}
