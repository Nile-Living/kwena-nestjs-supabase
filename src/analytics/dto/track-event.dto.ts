import { IsString, IsOptional, IsObject, IsEnum } from 'class-validator';

export enum EventType {
  PROPERTY_VIEW = 'property_view',
  PROPERTY_SAVE = 'property_save',
  PROPERTY_CONTACT = 'property_contact',
  SEARCH_PERFORMED = 'search_performed',
  USER_LOGIN = 'user_login',
  SUBSCRIPTION_UPGRADE = 'subscription_upgrade',
  PROPERTY_SHARE = 'property_share',
}

export class TrackEventDto {
  @IsEnum(EventType)
  event_type: EventType;

  @IsString()
  @IsOptional()
  property_id?: string;

  @IsString()
  @IsOptional()
  search_query?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}