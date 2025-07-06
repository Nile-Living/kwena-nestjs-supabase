// src/payments/dto/initiate-payment.dto.ts
import { IsString, IsNumber, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export enum PaymentMethod {
  MOMO = 'momo',
  CARD = 'card',
}

export class InitiatePaymentDto {
  @IsNumber()
  amount: number;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod = PaymentMethod.MOMO;

  @IsString()
  @IsOptional()
  operator?: string;

  @IsString()
  @IsOptional()
  description?: string;

  // Card payment specific fields (for Zynle card payments)
  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  first_name?: string;

  @IsString()
  @IsOptional()
  last_name?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  zip_code?: string;

  @IsString()
  @IsOptional()
  country?: string;
}