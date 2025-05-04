import {
    IsNotEmpty,
    IsString,
    IsIn,
    IsUUID,
    Matches,
    IsOptional,
  } from 'class-validator';
  
  const allowedPlanIds = ['7days', '14days', '1month'];
  const allowedOperators = ['airtel', 'mtn', 'zamtel']; // Zambia specific
  
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
    operator?: string; // Optional: Backend could try to determine or require it
  }
  