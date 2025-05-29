import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class SubscriptionFeaturesDto {
  @IsNumber()
  max_saved_searches: number;

  @IsBoolean()
  priority_notifications: boolean;

  @IsBoolean()
  advanced_filters: boolean;

  @IsBoolean()
  property_alerts: boolean;

  @IsNumber()
  @IsOptional()
  api_rate_limit?: number;

  @IsBoolean()
  @IsOptional()
  analytics_access?: boolean;
}