// src/payments/dto/submit-otp.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitOtpDto {
  @IsString()
  @IsNotEmpty()
  reference: string;

  @IsString()
  @IsNotEmpty()
  otp: string;
}
