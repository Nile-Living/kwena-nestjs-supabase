import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  ValidateNested,
  IsBoolean,
  IsIn,
  IsPositive,
  IsPhoneNumber,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { CoordinatesDto } from './coordinates.dto';

const allowedCommercialSubTypes = [
  'Office', 'Retail', 'Warehouse', 'Industrial',
  'Mixed-Use', 'Restaurant', 'Other',
];

export class CreateHouseDetailsDto {
  @IsInt() @Min(1) bedrooms: number;
  @IsInt() @Min(1) bathrooms: number;
  @IsOptional() @IsInt() @Min(0) garages?: number;
  @IsOptional() @IsInt() @Min(0) parkings?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) amenities?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) security_features?: string[];
}

export class CreateLandDetailsDto {
  @IsNumber() @Min(1) size_sqm: number;
  @IsString() @IsNotEmpty() legal_status: string;
  @IsString() @IsNotEmpty() intended_use: string;
  @IsBoolean() road_access: boolean;
  @IsString() @IsNotEmpty() water_supply: string;
  @IsBoolean() electricity_available: boolean;
  @IsBoolean() fenced: boolean;
}

export class CreateApartmentDetailsDto {
  @IsInt() @Min(1, { message: 'Apartment must have at least 1 bedroom' }) bedrooms: number;
  @IsInt() @Min(1, { message: 'Apartment must have at least 1 bathroom' }) bathrooms: number;
  @IsNumber({}, { message: 'Square meters must be a number.' })
  @IsPositive({ message: 'Square meters must be a positive value.' }) square_meters: number;
  @IsOptional() @IsArray() @IsString({ each: true, message: 'Each amenity must be a string.' }) amenities?: string[];
  @IsOptional() @IsInt({ message: 'Parking spaces must be an integer.' }) @Min(0, { message: 'Parking spaces cannot be negative.' }) parking_spaces?: number;
  @IsOptional() @IsArray() @IsString({ each: true, message: 'Each security feature must be a string.' }) security_features?: string[];
}

export class CreateCommercialDetailsDto {
  @IsString() @IsNotEmpty({ message: 'Commercial property type is required.' })
  @IsIn(allowedCommercialSubTypes, { message: `Commercial property type must be one of: ${allowedCommercialSubTypes.join(', ')}`})
  property_type: string;
  @IsNumber({}, { message: 'Square meters must be a number.' })
  @IsPositive({ message: 'Square meters must be a positive value.' }) square_meters: number;
  @IsOptional() @IsInt({ message: 'Parking spaces must be an integer.' }) @Min(0, { message: 'Parking spaces cannot be negative.' }) parking_spaces?: number;
  @IsOptional() @IsArray() @IsString({ each: true, message: 'Each amenity must be a string.' }) amenities?: string[];
  @IsOptional() @IsArray() @IsString({ each: true, message: 'Each security feature must be a string.' }) security_features?: string[];
}

export class CreatePropertyDto {
  @IsString() @IsNotEmpty() title: string;
  @IsNumber() @Min(0) price: number;
  @IsString() @IsNotEmpty() location: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (e) { return value; }
    }
    return value;
  })
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates?: CoordinatesDto;

  @IsOptional() @IsString() description?: string;
  @IsString() @IsNotEmpty() user_id: string;
  @IsOptional() @IsString() agent_id?: string;

  @IsIn(['rent', 'sale'])
  property_type: 'rent' | 'sale';

  @IsString() @IsNotEmpty() category: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (e) { return value; }
    }
    return value;
  })
  @ValidateNested()
  @Type((opts) => {
    const DTOObject = opts?.object as CreatePropertyDto;
    const category = DTOObject?.category;
    switch (category) {
      case 'house': return CreateHouseDetailsDto;
      case 'land': return CreateLandDetailsDto;
      case 'apartment': return CreateApartmentDetailsDto;
      case 'commercial': return CreateCommercialDetailsDto;
      default: return Object;
    }
  })
  details?:
    | CreateHouseDetailsDto
    | CreateLandDetailsDto
    | CreateApartmentDetailsDto
    | CreateCommercialDetailsDto;

  @IsOptional() @IsString() contact_phone_number?: string;
  @IsOptional() @IsString() contact_whatsapp_number?: string;
  @IsOptional() @IsBoolean() @Transform(({ value }) => value === 'true' || value === true || value === 'on' || value === 1) use_phone_for_call?: boolean;
  @IsOptional() @IsBoolean() @Transform(({ value }) => value === 'true' || value === true || value === 'on' || value === 1) use_whatsapp_for_message?: boolean;
}
