import {
  CreateHouseDetailsDto,
  CreateLandDetailsDto,
  CreateApartmentDetailsDto,
  CreateCommercialDetailsDto,
} from './create-property.dto';
import { CoordinatesDto } from './coordinates.dto';

export interface UserProfileDto {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  role: string | null;
  created_at: string | null;
}

export interface NearbyPlace {
  name: string;
  distance: string;
  icon: string;
}

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
  details?:
    | CreateHouseDetailsDto
    | CreateLandDetailsDto
    | CreateApartmentDetailsDto
    | CreateCommercialDetailsDto
    | any;
  contact_phone_number?: string;
  contact_whatsapp_number?: string;
  use_phone_for_call?: boolean;
  use_whatsapp_for_message?: boolean;
  nearby_places?: NearbyPlace[];
  userProfile?: UserProfileDto | null;
}

export class PropertyResponseDto {
  properties: Property[];
  total: number;
  page: number;
  pageSize: number;
}