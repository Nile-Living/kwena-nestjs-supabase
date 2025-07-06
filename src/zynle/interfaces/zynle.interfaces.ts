// src/zynle/interfaces/zynle.interfaces.ts
export interface ZynleAuthRequest {
    merchant_id: string;
    api_id: string;
    api_key: string;
    channel: 'card' | 'momo';
  }
  
  export interface ZynleMomoDepositData {
    method: 'runBillPayment';
    sender_id: string;
    reference_no: string;
    amount: string;
  }
  
  export interface ZynleCardDepositData {
    method: 'runTranAuthCapture';
    reference_no: string;
    amount: string;
    description: string;
    first_name: string;
    last_name: string;
    address: string;
    email: string;
    phone: string;
    city: string;
    state: string;
    currency: string;
    zip_code: string;
    country: string;
  }
  
  export interface ZynleDepositRequest {
    auth: ZynleAuthRequest;
    data: ZynleMomoDepositData | ZynleCardDepositData;
  }
  
  export interface ZynleInitialResponse {
    response_code: string;
    response_description: string;
    reference_no: string;
    transaction_id: string;
    operator_reference: string;
    redirect_url?: string; // For card payments
    sender_id?: string; // For momo payments
    operator?: string; // For momo payments
    transaction_date?: string;
    amount: string;
  }
  
  export interface ZynleCallbackResponse {
    response_code: string;
    response_description?: string;
    message?: string;
    reference_no: string;
    transaction_id?: string;
    operator_reference?: string;
    sender_id?: string;
    operator?: string;
    transaction_date?: string;
    account_name?: string;
    birthday?: string;
    currency?: string;
    date?: string;
    amount?: string;
  }
  
  export interface ZynlePaymentStatusRequest {
    reference_no: string;
    api_id: string;
    api_key: string;
  }
  
  export interface ZynlePaymentStatusResponse {
    response_code: string;
    message: string;
    reference_no: string;
  }
  
  export interface ZynleCollectionRequestBody {
    amount: number;
    reference: string;
    phone: string;
    operator?: string;
    method: 'momo' | 'card';
    // Card-specific fields
    email?: string;
    first_name?: string;
    last_name?: string;
    address?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    country?: string;
    description?: string;
  }
  
  export interface ZynleCollectionResponseData {
    reference: string;
    transaction_id: string;
    status: string;
    amount: string;
    redirect_url?: string; // For card payments
    operator?: string; // For momo payments
    message: string;
  }