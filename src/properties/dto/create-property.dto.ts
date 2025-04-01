import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CoordinatesDto } from './coordinates.dto';

export class CreatePropertyDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsString()
  @IsNotEmpty()
  location: string;

  @IsInt()
  @Min(0)
  bedrooms: number;

  @IsInt()
  @Min(0)
  bathrooms: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates?: CoordinatesDto;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  agent_id?: string;

  @IsString()
  @IsNotEmpty() // Assuming user_id is required
  user_id: string; // Changed from UserID

  @IsString()
  @IsNotEmpty()
  property_type: string; // Changed from PropertyType

  @IsString()
  @IsOptional()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  garage?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  parkings?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  security_features?: string[];
}
