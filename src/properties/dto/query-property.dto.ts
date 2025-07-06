import { Transform, Type } from "class-transformer";
import {
  IsOptional,
  IsNumber,
  Min,
  IsString,
  IsInt,
  Max,
  IsIn,
  IsBoolean,
  IsUUID,
  IsArray,
} from "class-validator";

const allowedSortFields = [
  "created_at",
  "price",
  "title",
  "bedrooms",
  "bathrooms",
  "garages",
  "parkings",
  "parking_spaces",
  "size_sqm",
  "square_meters",
  "status",
];
const allowedSortOrders = ["asc", "desc"];
const allowedSortStrings = allowedSortFields.flatMap((field) =>
  allowedSortOrders.map((order) => `${field}.${order}`),
);
const allowedStatuses = [
  "available",
  "occupied",
  "rented",
  "off-market",
  "under-maintenance",
  "pending-approval",
];
const allowedCommercialSubTypes = [
  "Office",
  "Retail",
  "Warehouse",
  "Industrial",
  "Mixed-Use",
  "Restaurant",
  "Other",
];

export class QueryPropertyDto {
  @IsOptional()
  @IsUUID("4", { message: "Session ID must be a valid UUID if provided." })
  sessionId?: string;

  @IsOptional()
  @IsInt({ message: "Page must be an integer." })
  @Min(1, { message: "Page must be at least 1." })
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt({ message: "Page size must be an integer." })
  @Min(1, { message: "Page size must be at least 1." })
  @Max(100, { message: "Page size cannot exceed 100." })
  @Type(() => Number)
  pageSize?: number = 10;

  @IsOptional()
  @IsString()
  @IsIn(allowedSortStrings, {
    message: `Sort must be in the format 'field.direction'. Allowed fields: ${allowedSortFields.join(
      ", ",
    )}. Allowed directions: asc, desc.`,
  })
  sort?: string;

  @IsOptional()
  @IsNumber({}, { message: "Minimum price must be a number." })
  @Min(0, { message: "Minimum price cannot be negative." })
  @Type(() => Number)
  minPrice?: number;

  @IsOptional()
  @IsNumber({}, { message: "Maximum price must be a number." })
  @Min(0, { message: "Maximum price cannot be negative." })
  @Type(() => Number)
  maxPrice?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(["rent", "sale"], { message: 'Property type must be "rent" or "sale".' })
  propertyType?: "rent" | "sale";

  @IsOptional()
  @IsString()
  @IsIn(allowedStatuses, {
    message: `Status must be one of: ${allowedStatuses.join(", ")}`,
  })
  status?: string;

  @IsOptional()
  @IsUUID("4", { message: "User ID must be a valid UUID." })
  user_id?: string;

  @IsOptional()
  @IsUUID("4", { message: "Agent ID must be a valid UUID." })
  agent_id?: string;

  @IsOptional()
  @IsInt({ message: "Bedrooms filter must be an integer." })
  @Min(0, { message: "Bedrooms filter cannot be negative." })
  @Type(() => Number)
  bedrooms?: number;

  @IsOptional()
  @IsInt({ message: "Bathrooms filter must be an integer." })
  @Min(0, { message: "Bathrooms filter cannot be negative." })
  @Type(() => Number)
  bathrooms?: number;

  @IsOptional()
  @IsInt({ message: "Garages filter must be an integer." })
  @Min(0, { message: "Garages filter cannot be negative." })
  @Type(() => Number)
  garages?: number;

  @IsOptional()
  @IsInt({ message: "House parkings filter must be an integer." })
  @Min(0, { message: "House parkings filter cannot be negative." })
  @Type(() => Number)
  house_parkings?: number;

  @IsOptional()
  @IsNumber({}, { message: "Minimum land size must be a number." })
  @Min(0, { message: "Minimum land size cannot be negative." })
  @Type(() => Number)
  min_size_sqm?: number;

  @IsOptional()
  @IsNumber({}, { message: "Maximum land size must be a number." })
  @Min(0, { message: "Maximum land size cannot be negative." })
  @Type(() => Number)
  max_size_sqm?: number;

  @IsOptional()
  @IsString()
  legal_status?: string;

  @IsOptional()
  @IsString()
  intended_use?: string;

  @IsOptional()
  @IsBoolean({ message: "Road access filter must be a boolean (true/false)." })
  @Transform(({ value }) => value === "true" || value === true)
  road_access?: boolean;

  @IsOptional()
  @IsString()
  water_supply?: string;

  @IsOptional()
  @IsBoolean({
    message: "Electricity available filter must be a boolean (true/false).",
  })
  @Transform(({ value }) => value === "true" || value === true)
  electricity_available?: boolean;

  @IsOptional()
  @IsBoolean({ message: "Fenced filter must be a boolean (true/false)." })
  @Transform(({ value }) => value === "true" || value === true)
  fenced?: boolean;

  @IsOptional()
  @IsNumber({}, { message: "Minimum square meters must be a number." })
  @Min(0, { message: "Minimum square meters cannot be negative." })
  @Type(() => Number)
  min_square_meters?: number;

  @IsOptional()
  @IsNumber({}, { message: "Maximum square meters must be a number." })
  @Min(0, { message: "Maximum square meters cannot be negative." })
  @Type(() => Number)
  max_square_meters?: number;

  @IsOptional()
  @IsInt({ message: "Parking spaces filter must be an integer." })
  @Min(0, { message: "Parking spaces filter cannot be negative." })
  @Type(() => Number)
  parking_spaces?: number;

  @IsOptional()
  @IsString()
  @IsIn(allowedCommercialSubTypes, {
    message: `Commercial property type must be one of: ${allowedCommercialSubTypes.join(
      ", ",
    )}`,
  })
  commercial_property_type?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  amenities?: string[];

  @IsOptional()
  @IsString()
  features?: string;
}