// dto/property.response.dto.ts

import {
    CreateHouseDetailsDto,
    CreateLandDetailsDto,
    CreateApartmentDetailsDto,
    CreateCommercialDetailsDto,
    // You might not need to import CreatePropertyDto here anymore for this specific interface
  } from './create-property.dto'; // Or from './detail-dtos' if you moved them
  import { CoordinatesDto } from './coordinates.dto'; // Assuming this exists
  
  // Define the core fields that a Property will always have in responses/storage
  // This is separate from what the client sends for creation.
  export interface Property {
    id: string;
    title: string;
    price: number;
    location: string;
    images: string[];
    coordinates?: CoordinatesDto;
    description?: string;
    property_type: 'rent' | 'sale';
    category: string;
    user_id: string;
    agent_id?: string;
    created_at: string;
    status?: string;
    last_updated?: string;
    is_promoted?: boolean;
    details?: // This structure should match what your service populates for details
      | CreateHouseDetailsDto // Or a specific "ResponseHouseDetailsDto" if different
      | CreateLandDetailsDto
      | CreateApartmentDetailsDto
      | CreateCommercialDetailsDto
      | any; // Fallback, but try to be specific
  }
  
  export class PropertyResponseDto {
    properties: Property[];
    total: number;
    page: number;
    pageSize: number;
  }
  