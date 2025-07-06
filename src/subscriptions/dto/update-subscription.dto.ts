import { PartialType } from "@nestjs/mapped-types";
import { IsEnum, IsOptional, IsDateString } from "class-validator";
import { CreateSubscriptionDto } from "./create-subscription.dto";

export enum SubscriptionStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    EXPIRED = 'expired',
    CANCELLED = 'cancelled'
}

export class UpdateSubscriptionDto extends PartialType(CreateSubscriptionDto) {
    @IsEnum(SubscriptionStatus)
    @IsOptional()
    status?: SubscriptionStatus;

    @IsDateString()
    @IsOptional()
    expires_at?: string;
}
