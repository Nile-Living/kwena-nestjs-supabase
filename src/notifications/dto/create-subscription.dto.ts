import { IsString, IsNotEmpty, IsNumber, IsOptional } from "class-validator";

export class CreateSubscriptionDto {
    @IsString()
    @IsNotEmpty()
    subscription_type: string;

    @IsNumber()
    duration_months: number;

    @IsString()
    @IsOptional()
    payment_reference?: string;
}