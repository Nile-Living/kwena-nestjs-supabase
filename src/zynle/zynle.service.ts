// src/zynle/zynle.service.ts
import {
    Injectable,
    Logger,
    HttpException,
    HttpStatus,
    InternalServerErrorException,
  } from '@nestjs/common';
  import { ConfigService } from '@nestjs/config';
  import {
    ZynleDepositRequest,
    ZynleInitialResponse,
    ZynlePaymentStatusRequest,
    ZynlePaymentStatusResponse,
    ZynleCollectionRequestBody,
    ZynleCollectionResponseData,
    ZynleMomoDepositData,
    ZynleCardDepositData,
  } from './interfaces/zynle.interfaces';
  
  @Injectable()
  export class ZynleService {
    private readonly logger = new Logger(ZynleService.name);
    private readonly merchantId: string;
    private readonly apiId: string;
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly paymentStatusUrl: string;
  
    constructor(private readonly configService: ConfigService) {
      this.merchantId = this.configService
        .getOrThrow<string>('ZYNLE_MERCHANT_ID')
        .trim();
      this.apiId = this.configService.getOrThrow<string>('ZYNLE_API_ID').trim();
      this.apiKey = this.configService
        .getOrThrow<string>('ZYNLE_API_KEY')
        .trim();
      this.baseUrl = this.configService
        .getOrThrow<string>('ZYNLE_API_BASE_URL')
        .trim();
      this.paymentStatusUrl = this.configService
        .getOrThrow<string>('ZYNLE_PAYMENT_STATUS_URL')
        .trim();
    }
  
    async initiateMobileMoneyCollection(
      payload: ZynleCollectionRequestBody,
    ): Promise<ZynleCollectionResponseData> {
      if (payload.method === 'card') {
        return this.initiateCardPayment(payload);
      } else {
        return this.initiateMomoPayment(payload);
      }
    }
  
private async initiateMomoPayment(
    payload: ZynleCollectionRequestBody,
  ): Promise<ZynleCollectionResponseData> {
    const url = this.baseUrl;
    this.logger.log(
      `Initiating Zynle momo payment for ref: ${payload.reference}`,
    );
  
    const requestBody: ZynleDepositRequest = {
      auth: {
        merchant_id: this.merchantId,
        api_id: this.apiId,
        api_key: this.apiKey,
        channel: 'momo',
      },
      data: {
        method: 'runBillPayment',
        sender_id: payload.phone,
        reference_no: payload.reference,
        amount: payload.amount.toString(),
      } as ZynleMomoDepositData,
    };
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
  
      const responseData: any = await response.json();
      this.logger.debug(
        `Zynle momo response for ${payload.reference}: ${JSON.stringify(
          responseData,
        )}`,
      );
  
      if (!response.ok) {
        this.logger.error(
          `Zynle momo payment failed for ${payload.reference}. Status: ${response.status}`,
        );
        throw new HttpException(
          responseData.response?.response_description ||
            responseData.response_description ||
            'Failed to initiate mobile money payment',
          response.status || HttpStatus.BAD_GATEWAY,
        );
      }
  
      // Handle both nested and direct response structures
      const actualResponse = responseData.response || responseData;
      
      // Check for successful initiation (120 = Transaction is initiated)
      if (actualResponse.response_code !== '120') {
        this.logger.error(
          `Zynle momo payment initiation failed for ${payload.reference}. Code: ${actualResponse.response_code}, Message: ${actualResponse.response_description}`,
        );
        throw new HttpException(
          actualResponse.response_description ||
            'Failed to initiate mobile money payment',
          HttpStatus.BAD_REQUEST,
        );
      }
  
      return {
        reference: actualResponse.reference_no,
        transaction_id: actualResponse.transaction_id?.toString(),
        status: 'initiated',
        amount: actualResponse.amount || payload.amount.toString(),
        operator: actualResponse.operator,
        message: actualResponse.response_description,
      };
    } catch (error) {
      this.logger.error(
        `Error calling Zynle momo API for reference ${payload.reference}: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `Failed to initiate momo payment with Zynle: ${error.message}`,
      );
    }
  }
  
  private async initiateCardPayment(
    payload: ZynleCollectionRequestBody,
  ): Promise<ZynleCollectionResponseData> {
    const url = this.baseUrl;
    this.logger.log(
      `Initiating Zynle card payment for ref: ${payload.reference}`,
    );
  
    const requestBody: ZynleDepositRequest = {
      auth: {
        merchant_id: this.merchantId,
        api_id: this.apiId,
        api_key: this.apiKey,
        channel: 'card',
      },
      data: {
        method: 'runTranAuthCapture',
        reference_no: payload.reference,
        amount: payload.amount.toString(),
        description: payload.description || 'Subscription payment',
        first_name: payload.first_name || 'User',
        last_name: payload.last_name || 'Name',
        address: payload.address || 'N/A',
        email: payload.email || 'user@example.com',
        phone: payload.phone,
        city: payload.city || 'Lusaka',
        state: payload.state || 'Lusaka',
        currency: 'ZMW',
        zip_code: payload.zip_code || '10101',
        country: payload.country || 'ZMB',
      } as ZynleCardDepositData,
    };
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
  
      const responseData: any = await response.json();
      this.logger.debug(
        `Zynle card response for ${payload.reference}: ${JSON.stringify(
          responseData,
        )}`,
      );
  
      if (!response.ok) {
        this.logger.error(
          `Zynle card payment failed for ${payload.reference}. Status: ${response.status}`,
        );
        throw new HttpException(
          responseData.response?.response_description ||
            responseData.response_description ||
            'Failed to initiate card payment',
          response.status || HttpStatus.BAD_GATEWAY,
        );
      }
  
      // Handle both nested and direct response structures
      const actualResponse = responseData.response || responseData;
  
      // Check for successful initiation (120 = Redirect)
      if (actualResponse.response_code !== '120') {
        this.logger.error(
          `Zynle card payment initiation failed for ${payload.reference}. Code: ${actualResponse.response_code}, Message: ${actualResponse.response_description}`,
        );
        throw new HttpException(
          actualResponse.response_description ||
            'Failed to initiate card payment',
          HttpStatus.BAD_REQUEST,
        );
      }
  
      return {
        reference: actualResponse.reference_no,
        transaction_id: actualResponse.transaction_id?.toString(),
        status: 'redirect',
        amount: actualResponse.amount || payload.amount.toString(),
        redirect_url: actualResponse.redirect_url,
        message: actualResponse.response_description,
      };
    } catch (error) {
      this.logger.error(
        `Error calling Zynle card API for reference ${payload.reference}: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `Failed to initiate card payment with Zynle: ${error.message}`,
      );
    }
  }
  
  async verifyPayment(
    reference: string,
  ): Promise<ZynlePaymentStatusResponse | null> {
    const url = this.paymentStatusUrl;
    this.logger.log(
      `Verifying Zynle payment for reference: ${reference} at ${url}`,
    );
  
    const requestBody: ZynlePaymentStatusRequest = {
      reference_no: reference,
      api_id: this.apiId,
      api_key: this.apiKey,
    };
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
  
      const responseData: any = await response.json();
      this.logger.debug(
        `Zynle verification response for ${reference}: ${JSON.stringify(
          responseData,
        )}`,
      );
  
      if (!response.ok) {
        this.logger.warn(
          `Zynle verification failed for ${reference}. Status: ${response.status}`,
        );
        return null;
      }
  
      // Handle both nested and direct response structures
      const actualResponse = responseData.response || responseData;
  
      return {
        response_code: actualResponse.response_code,
        message: actualResponse.message || actualResponse.response_description,
        reference_no: actualResponse.reference_no,
      };
    } catch (error) {
      this.logger.error(
        `Error calling Zynle verify API for reference ${reference}: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }
  
    // Helper method to determine if payment is successful based on response code
    isPaymentSuccessful(responseCode: string): boolean {
      return responseCode === '100'; // Successful Transaction
    }
  
    // Helper method to determine if payment is pending
    isPaymentPending(responseCode: string): boolean {
      return responseCode === '120' || responseCode === '990'; // Initiated or Pending
    }
  
    // Helper method to determine if payment failed
    isPaymentFailed(responseCode: string): boolean {
      return responseCode === '995' || responseCode.startsWith('99'); // Failed or error codes
    }
  }