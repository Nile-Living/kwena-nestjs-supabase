// src/properties/dto/query-property.dto.ts
import { Transform, Type } from 'class-transformer';
import {
  IsOptional,
  IsNumber,
  Min,
  IsString,
  IsInt,
  Max,
  IsIn,
  IsBoolean,
  IsUUID, // Import IsUUID if you want to validate user/agent IDs
} from 'class-validator';

// Updated allowed fields for sorting based on schema and potential RPC aliases
const allowedSortFields = [
  'created_at', // properties
  'price', // properties
  'title', // properties
  'bedrooms', // house/apartment (use COALESCE in RPC)
  'bathrooms', // house/apartment (use COALESCE in RPC)
  'garages', // house
  'parkings', // house (maps to h.parkings in RPC)
  'parking_spaces', // apartment/commercial (maps to a.parking_spaces/c.parking_spaces in RPC)
  'size_sqm', // land (maps to l.size_sqm in RPC)
  'square_meters', // apartment/commercial (maps to a.square_meters/c.square_meters in RPC)
  'status', // property_status
];

const allowedSortOrders = ['asc', 'desc'];
const allowedSortStrings = allowedSortFields.flatMap((field) =>
  allowedSortOrders.map((order) => `${field}.${order}`),
);

// Optional: Define allowed statuses if you have a fixed list
const allowedStatuses = [
  'available',
  'occupied',
  'rented',
  'off-market',
  'under-maintenance',
  'pending-approval',
];

// Optional: Define allowed commercial sub-types
const allowedCommercialSubTypes = [
  'Office',
  'Retail',
  'Warehouse',
  'Industrial',
  'Mixed-Use',
  'Restaurant',
  'Other',
];

export class QueryPropertyDto {
  // --- Pagination ---
  @IsOptional()
  @IsInt({ message: 'Page must be an integer.' })
  @Min(1, { message: 'Page must be at least 1.' })
  @Type(() => Number)
  page?: number = 1; // Default set in service/RPC if needed

  @IsOptional()
  @IsInt({ message: 'Page size must be an integer.' })
  @Min(1, { message: 'Page size must be at least 1.' })
  @Max(100, { message: 'Page size cannot exceed 100.' }) // Example max limit
  @Type(() => Number)
  pageSize?: number = 10; // Default set in service/RPC if needed

  // --- Sorting ---
  @IsOptional()
  @IsString()
  @IsIn(allowedSortStrings, {
    message: `Sort must be in the format 'field.direction'. Allowed fields: ${allowedSortFields.join(
      ', ',
    )}. Allowed directions: asc, desc.`,
  })
  sort?: string; // e.g., "price.asc", "created_at.desc"

  // --- Base Filters ---
  @IsOptional()
  @IsNumber({}, { message: 'Minimum price must be a number.' })
  @Min(0, { message: 'Minimum price cannot be negative.' })
  @Type(() => Number)
  minPrice?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Maximum price must be a number.' })
  @Min(0, { message: 'Maximum price cannot be negative.' })
  @Type(() => Number)
  maxPrice?: number;

  @IsOptional()
  @IsString()
  location?: string; // For ILIKE search

  @IsOptional()
  @IsString()
  // Consider adding @IsIn(['house', 'land', 'apartment', 'commercial'])
  category?: string; // Filter by category

  @IsOptional()
  @IsIn(['rent', 'sale'], { message: 'Property type must be "rent" or "sale".' })
  propertyType?: 'rent' | 'sale';

  @IsOptional()
  @IsString()
  @IsIn(allowedStatuses, {
    message: `Status must be one of: ${allowedStatuses.join(', ')}`,
  })
  status?: string; // Filter by property_status.status

  @IsOptional()
  @IsUUID('4', { message: 'User ID must be a valid UUID.' })
  user_id?: string; // Filter by properties.user_id

  @IsOptional()
  @IsUUID('4', { message: 'Agent ID must be a valid UUID.' })
  agent_id?: string; // Filter by properties.agent_id

  // --- Category Specific Filters ---

  // House / Apartment Filters
  @IsOptional()
  @IsInt({ message: 'Bedrooms filter must be an integer.' })
  @Min(0, { message: 'Bedrooms filter cannot be negative.' })
  @Type(() => Number)
  bedrooms?: number; // Minimum number of bedrooms (applies to house & apartment)

  @IsOptional()
  @IsInt({ message: 'Bathrooms filter must be an integer.' })
  @Min(0, { message: 'Bathrooms filter cannot be negative.' })
  @Type(() => Number)
  bathrooms?: number; // Minimum number of bathrooms (applies to house & apartment)

  // House Filters
  @IsOptional()
  @IsInt({ message: 'Garages filter must be an integer.' })
  @Min(0, { message: 'Garages filter cannot be negative.' })
  @Type(() => Number)
  garages?: number; // Minimum number of garages (house only)

  @IsOptional()
  @IsInt({ message: 'House parkings filter must be an integer.' })
  @Min(0, { message: 'House parkings filter cannot be negative.' })
  @Type(() => Number)
  house_parkings?: number; // Minimum number of parkings (house only) - Renamed for clarity

  // Land Filters
  @IsOptional()
  @IsNumber({}, { message: 'Minimum land size must be a number.' })
  @Min(0, { message: 'Minimum land size cannot be negative.' })
  @Type(() => Number)
  min_size_sqm?: number; // Land only

  @IsOptional()
  @IsNumber({}, { message: 'Maximum land size must be a number.' })
  @Min(0, { message: 'Maximum land size cannot be negative.' })
  @Type(() => Number)
  max_size_sqm?: number; // Land only

  @IsOptional()
  @IsString()
  // Consider @IsIn(['Title Deed', 'Customary', 'Offer Letter'])
  legal_status?: string; // Land only

  @IsOptional()
  @IsString()
  // Consider @IsIn(['Residential', 'Agricultural', 'Commercial', 'Industrial'])
  intended_use?: string; // Land only

  @IsOptional()
  @IsBoolean({ message: 'Road access filter must be a boolean (true/false).' })
  @Transform(({ value }) => value === 'true' || value === true)
  road_access?: boolean; // Land only

  @IsOptional()
  @IsString() // Added based on schema
  // Consider @IsIn(['Borehole', 'Municipal', 'Well', 'None'])
  water_supply?: string; // Land only

  @IsOptional()
  @IsBoolean({
    message: 'Electricity available filter must be a boolean (true/false).',
  })
  @Transform(({ value }) => value === 'true' || value === true)
  electricity_available?: boolean; // Land only

  @IsOptional()
  @IsBoolean({ message: 'Fenced filter must be a boolean (true/false).' })
  @Transform(({ value }) => value === 'true' || value === true)
  fenced?: boolean; // Land only

  // Apartment / Commercial Filters
  @IsOptional()
  @IsNumber({}, { message: 'Minimum square meters must be a number.' })
  @Min(0, { message: 'Minimum square meters cannot be negative.' })
  @Type(() => Number)
  min_square_meters?: number; // Added for apt/comm

  @IsOptional()
  @IsNumber({}, { message: 'Maximum square meters must be a number.' })
  @Min(0, { message: 'Maximum square meters cannot be negative.' })
  @Type(() => Number)
  max_square_meters?: number; // Added for apt/comm

  @IsOptional()
  @IsInt({ message: 'Parking spaces filter must be an integer.' })
  @Min(0, { message: 'Parking spaces filter cannot be negative.' })
  @Type(() => Number)
  parking_spaces?: number; // Minimum number of parking_spaces (apt/comm only) - Renamed for clarity

  // Commercial Filters
  @IsOptional()
  @IsString()
  @IsIn(allowedCommercialSubTypes, {
    message: `Commercial property type must be one of: ${allowedCommercialSubTypes.join(
      ', ',
    )}`,
  })
  commercial_property_type?: string; // Commercial only (maps to property_details_commercial.property_type)

  // Note: Filters for array types like amenities/security_features are omitted
  // as they require more complex handling (e.g., comma-separated strings + array contains query)
}
