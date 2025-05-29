import { IsString, IsNotEmpty, IsObject, IsBoolean, IsOptional } from "class-validator";

export class CreateSavedSearchDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsObject()
    criteria: {
        property_type: 'rent' | 'sale';
        category?: string;
        location?: string;
        min_price?: number;
        max_price?: number;
        bedrooms?:  number;
        bathrooms?: number;
        min_square_meters?: number;
        max_square_meters?: number;
    };

    @IsBoolean()
    @IsOptional()
    notification_enabled?: boolean;
}