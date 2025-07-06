// Add this method to src/subscriptions/dto/create-subscription.dto.ts
import { IsString, IsNotEmpty, IsNumber, IsOptional } from "class-validator";

export enum SubscriptionType {
  BASIC = 'basic',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise'
}

export class CreateSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  subscription_type: SubscriptionType;

  @IsNumber()
  duration_months: number;

  @IsString()
  @IsOptional()
  payment_reference?: string;

  @IsNumber()
  @IsOptional()
  amount_paid?: number;

  @IsString()
  @IsOptional()
  currency?: string;
}
