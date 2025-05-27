import { IsString, IsNotEmpty, IsOptional, IsObject, IsUUID } from 'class-validator';

export class CreateNotificationDto {
  @IsUUID('4')
  @IsNotEmpty()
  user_id: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}