import { PartialType } from '@nestjs/mapped-types';
import { CreatePropertyDto } from './create-property.dto';
import { IsOptional, IsArray, IsString, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';


export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {
  @IsOptional() @IsInt() @Min(0) bedrooms?: number;
  @IsOptional() @IsInt() @Min(0) bathrooms?: number;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (e) { return [value]; }
    }
    if (Array.isArray(value)) return value;
    return [];
  })
  existingImageUrls?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
   @Transform(({ value }) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (e) { return [value]; }
    }
    if (Array.isArray(value)) return value;
    return [];
  })
  deletedImagePublicIds?: string[];
}
