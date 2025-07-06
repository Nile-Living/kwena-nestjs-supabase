import { IsOptional, IsDateString, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { EventType } from './track-event.dto';

export enum AnalyticsTimeRange {
  LAST_7_DAYS = '7d',
  LAST_30_DAYS = '30d',
  LAST_90_DAYS = '90d',
  CUSTOM = 'custom',
}

export class AnalyticsQueryDto {
  @IsEnum(AnalyticsTimeRange)
  @IsOptional()
  time_range?: AnalyticsTimeRange = AnalyticsTimeRange.LAST_30_DAYS;

  @IsDateString()
  @IsOptional()
  start_date?: string;

  @IsDateString()
  @IsOptional()
  end_date?: string;

  @IsEnum(EventType)
  @IsOptional()
  event_type?: EventType;

  @IsString()
  @IsOptional()
  property_id?: string;
}