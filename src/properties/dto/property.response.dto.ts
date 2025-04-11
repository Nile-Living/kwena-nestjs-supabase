import { CreateApartmentDetailsDto, CreateCommercialDetailsDto, CreateHouseDetailsDto, CreateLandDetailsDto, CreatePropertyDto } from "./create-property.dto";

export interface Property extends CreatePropertyDto {
    id: string;
    created_at: string;
    details?: CreateHouseDetailsDto | CreateLandDetailsDto | CreateApartmentDetailsDto | CreateCommercialDetailsDto
}

export class PropertyResponseDto {
    properties: Property[];
    total: number;
    page: number;
    pageSize: number;
}