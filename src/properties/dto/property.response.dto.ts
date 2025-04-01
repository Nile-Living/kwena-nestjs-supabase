import { CreatePropertyDto } from "./create-property.dto";

export interface Property extends CreatePropertyDto {
    id: string;
    created_at: string;
}

export class PropertyResponseDto {
    properties: Property[];
    total: number;
    page: number;
    pageSize: number;
}