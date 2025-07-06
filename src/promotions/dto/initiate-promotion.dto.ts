// src/promotions/dto/initiate-promotion.dto.ts
import {
  IsNotEmpty,
  IsString,
  IsIn,
  IsUUID,
  Matches,
  IsOptional,
  IsEnum,
} from 'class-validator';

const allowedPlanIds = ['7days', '14days', '1month'];
const allowedOperators = ['airtel', 'mtn', 'zamtel'];

export enum PaymentMethod {
  MOMO = 'momo',
  CARD = 'card',
}

export class InitiatePromotionDto {
  @IsNotEmpty()
  @IsUUID('4')
  propertyId: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(allowedPlanIds)
  planId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^0[79][567][0-9]{7}$/, {
    message: 'Invalid Zambian mobile money number format (e.g., 09..., 07...).',
  })
  mobileMoneyNumber: string;

  @IsOptional()
  @IsString()
  @IsIn(allowedOperators)
  operator?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  cardDetails?: {
    cardNumber?: string;
    expiryDate?: string;
    cvv?: string;
    cardholderName?: string;
    email?: string;
  };
}