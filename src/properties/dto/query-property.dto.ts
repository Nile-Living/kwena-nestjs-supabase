// src/properties/dto/query-property.dto.ts
import { Type } from "class-transformer";
import {
  IsOptional,
  IsNumber,
  Min,
  IsString,
  IsInt,
} from "class-validator";

export class QueryPropertyDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number; // Added based on Go model

  @IsOptional()
  @IsInt()
  @Min(0)
  garage?: number; // Added based on Go model

  @IsOptional()
  @IsInt()
  @Min(0)
  parkings?: number; // Added based on Go model

  @IsOptional()
  @IsString()
  propertyType?: string; // Changed from property_type for consistency

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number) // Ensure transformation from string query param
  page?: number = 1; // Default page

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number) // Ensure transformation from string query param
  pageSize?: number = 10; // Default page size

  @IsOptional()
  @IsString()
  sort?: string; // e.g., "price.asc", "createdAt.desc"
}
