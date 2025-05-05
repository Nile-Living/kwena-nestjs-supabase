import {
  Injectable,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from 'src/supabase/supabase.constants';
import { Property } from 'src/properties/dto/property.response.dto';

@Injectable()
export class SavedPropertiesService {
  private readonly logger = new Logger(SavedPropertiesService.name);
  private readonly tableName = 'saved_properties';

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findSavedPropertyIds(userId: string): Promise<string[]> {
    this.logger.log(`Fetching saved property IDs for user: ${userId}`);
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('property_id')
        .eq('user_id', userId);

      if (error) {
        this.logger.error(
          `Error fetching saved properties for user ${userId}: ${error.message}`,
          error.stack,
        );
        throw error;
      }
      const propertyIds = (data || []).map((item) => item.property_id);
      this.logger.log(
        `Found ${propertyIds.length} saved properties for user: ${userId}`,
      );
      return propertyIds;
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to retrieve saved properties: ${error.message}`,
      );
    }
  }

  async findSavedPropertyDetails(userId: string): Promise<Property[]> {
    this.logger.log(`Fetching saved property details for user: ${userId}`);
    const propertyIds = await this.findSavedPropertyIds(userId); // Reuse existing method

    if (!propertyIds || propertyIds.length === 0) {
      return []; // No saved properties
    }

    try {
      // Fetch details for these IDs using the view
      const { data: propertiesData, error: detailError } = await this.supabase
        .from('properties_view') // Use the view
        .select('*')
        .in('id', propertyIds);

      if (detailError) {
        this.logger.error(
          `Error fetching saved property details for user ${userId}: ${detailError.message}`,
        );
        throw new InternalServerErrorException(
          'Could not fetch saved property details.',
        );
      }

      // Map data to Property type (reuse mapping logic if needed)
      const properties: Property[] = (propertiesData || []).map((viewRow) => {
        // --- Start: Reuse mapping logic from PropertiesService ---
         const {
           effective_bedrooms, effective_bathrooms, house_garages, house_parkings, house_amenities, house_security_features,
           land_size_sqm, land_legal_status, land_intended_use, land_road_access, land_water_supply, land_electricity_available, land_fenced,
           apt_square_meters, apt_amenities, apt_parking_spaces, apt_security_features,
           comm_property_type, comm_square_meters, comm_parking_spaces, comm_amenities, comm_security_features,
           id, title, price, location, images, coordinates, description, property_type, category, user_id, agent_id, created_at, status, last_updated, is_promoted, promotion_expires_at,
         } = viewRow;
         let details: any = {};
         switch (category) {
           case 'house': details = { bedrooms: effective_bedrooms, bathrooms: effective_bathrooms, garages: house_garages, parkings: house_parkings, amenities: house_amenities, security_features: house_security_features }; break;
           case 'land': details = { size_sqm: land_size_sqm, legal_status: land_legal_status, intended_use: land_intended_use, road_access: land_road_access, water_supply: land_water_supply, electricity_available: land_electricity_available, fenced: land_fenced }; break;
           case 'apartment': details = { bedrooms: effective_bedrooms, bathrooms: effective_bathrooms, square_meters: apt_square_meters, amenities: apt_amenities, parking_spaces: apt_parking_spaces, security_features: apt_security_features }; break;
           case 'commercial': details = { property_type: comm_property_type, square_meters: comm_square_meters, parking_spaces: comm_parking_spaces, amenities: comm_amenities, security_features: comm_security_features }; break;
         }
         Object.keys(details).forEach((key) => details[key] == null && delete details[key]);
         return {
           id, title, price, location, images, coordinates, description, property_type, category, user_id, agent_id, created_at, status, last_updated,
           details: Object.keys(details).length > 0 ? details : undefined,
           is_promoted,
           liked: true, // Mark as liked since it's from the saved list
         } as Property;
         // --- End: Reuse mapping logic ---
      });

      return properties;
    } catch (error) {
       this.logger.error(`Error during saved property detail fetch for user ${userId}: ${error.message}`);
       throw new InternalServerErrorException('Could not fetch saved property details.');
    }
  }

  async addSavedProperty(userId: string, propertyId: string): Promise<void> {
    this.logger.log(
      `Attempting to save property ${propertyId} for user: ${userId}`,
    );

    try {
      const { error } = await this.supabase.from(this.tableName).insert({
        user_id: userId,
        property_id: propertyId,
      });

      if (error) {
        if (error.code === '23505') {
          this.logger.warn(
            `Property ${propertyId} already saved for user ${userId}. Ignoring duplicate request.`,
          );
          return;
        } else {
          this.logger.error(
            `Error saving property ${propertyId} for user ${userId}: ${error.message}`,
            error.stack,
          );
          throw error;
        }
      }
      this.logger.log(
        `Successfully saved property ${propertyId} for user: ${userId}`,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to save property: ${error.message}`,
      );
    }
  }

  async removeSavedProperty(userId: string, propertyId: string): Promise<void> {
    this.logger.log(
      `Attempting to remove saved property ${propertyId} for user: ${userId}`,
    );
    try {
      const { error, count } = await this.supabase
        .from(this.tableName)
        .delete({ count: 'exact' })
        .match({
          user_id: userId,
          property_id: propertyId,
        });

      if (error) {
        this.logger.error(
          `Error removing saved property ${propertyId} for user ${userId}: ${error.message}`,
          error.stack,
        );
        throw error;
      }
      if (count === 0) {
        this.logger.warn(
          `Saved property ${propertyId} not found for user ${userId} during removal, or already removed.`,
        );
        
      } else {
        this.logger.log(
          `Successfully removed saved property ${propertyId} for user: ${userId}`,
        );
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw new InternalServerErrorException(
          `Failed to remove saved property: ${error.message}`,
        );
      } else {
        throw error;
      }
    }
  }
}
