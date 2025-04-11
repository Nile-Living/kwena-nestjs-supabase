import {
  Injectable,
  Inject,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_CLIENT } from "../supabase/supabase.constants";
import { CreatePropertyDto } from "./dto/create-property.dto";
import { QueryPropertyDto } from "./dto/query-property.dto";
import {
  PropertyResponseDto,
  Property,
} from "./dto/property.response.dto";
import { UpdatePropertyDto } from "./dto/update-property.dto";

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);
  private readonly baseTableName = "properties";

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  // --- Helper to get detail table name (Keep as is) ---
  private getDetailTableName(category: string): string | null {
    const validCategories = ["house", "land", "apartment", "commercial"];
    if (validCategories.includes(category)) {
      return `property_details_${category}`;
    }
    this.logger.warn(`No detail table defined for category: ${category}`);
    return null;
  }

  // --- Create Method (Keep as is) ---
  async create(createPropertyDto: CreatePropertyDto): Promise<Property> {
    // ... (your existing create implementation)
    const { details, ...baseData } = createPropertyDto;
    this.logger.log(
      `Attempting to create base property for category: ${baseData.category}`,
    );

    // 1. Insert into base 'properties' table
    const { data: newBaseProperty, error: baseError } = await this.supabase
      .from(this.baseTableName)
      .insert(baseData)
      .select()
      .single();

    if (baseError || !newBaseProperty) {
      this.logger.error(
        `Error creating base property: ${baseError?.message}`,
        baseError?.stack,
      );
      throw new InternalServerErrorException(
        `Failed to create base property: ${baseError?.message || "Unknown error"}`,
      );
    }
    this.logger.log(`Base property created with ID: ${newBaseProperty.id}`);

    // 2. Insert into category-specific details table
    const detailTableName = this.getDetailTableName(baseData.category);
    if (details && Object.keys(details).length > 0 && detailTableName) {
      this.logger.log(
        `Inserting details into ${detailTableName} for property ${newBaseProperty.id}`,
      );
      const { error: detailError } = await this.supabase
        .from(detailTableName)
        .insert({ ...details, property_id: newBaseProperty.id }); // Add the FK

      if (detailError) {
        this.logger.error(
          `Error inserting details into ${detailTableName}: ${detailError.message}. Rolling back base property.`,
          detailError.stack,
        );
        // Attempt to clean up the orphaned base property record
        await this.supabase
          .from(this.baseTableName)
          .delete()
          .eq("id", newBaseProperty.id);
        throw new InternalServerErrorException(
          `Failed to insert property details: ${detailError.message}`,
        );
      }
      this.logger.log(
        `Details inserted successfully into ${detailTableName}`,
      );
    } else if (
      details &&
      Object.keys(details).length > 0 &&
      !detailTableName
    ) {
      this.logger.warn(
        `Details provided for property ${newBaseProperty.id}, but no detail table found for category ${baseData.category}.`,
      );
    }
    // Refetch to include details (or construct manually if preferred)
    // return this.findOne(newBaseProperty.id); // Or return newBaseProperty if details aren't needed immediately
    return newBaseProperty as Property; // Cast for now, assuming details aren't immediately needed back
  }

  // --- Find All Method (MODIFIED) ---
  // --- Find All Method (Using View) ---
  async findAll(queryDto: QueryPropertyDto): Promise<PropertyResponseDto> {
    const {
      page = 1,
      pageSize = 10,
      sort = "created_at.desc", // Default sort on view column
      category,
      propertyType,
      location,
      minPrice,
      maxPrice,
      bedrooms, // Corresponds to effective_bedrooms
      bathrooms, // Corresponds to effective_bathrooms
      garages, // Corresponds to effective_garages
      house_parkings, // Corresponds to effective_house_parkings
      min_size_sqm, // Corresponds to land_size_sqm or effective_square_meters
      max_size_sqm, // Corresponds to land_size_sqm or effective_square_meters
      legal_status, // Corresponds to land_legal_status
      intended_use, // Corresponds to land_intended_use
      road_access, // Corresponds to land_road_access
      water_supply, // Corresponds to land_water_supply
      electricity_available, // Corresponds to land_electricity_available
      fenced, // Corresponds to land_fenced
      parking_spaces, // Corresponds to effective_parking_spaces
      commercial_property_type, // Corresponds to commercial_property_type_detail
      status,
      user_id,
      agent_id,
    } = queryDto;

    const offset = (page - 1) * pageSize;
    const from = offset;
    const to = offset + pageSize - 1;

    // Query the view
    let query = this.supabase
      .from('properties_view') // Query the view directly
      .select('*', { count: 'exact' }); // Select all view columns, get total count

    // Apply Filters directly on view columns
    if (category) query = query.eq('category', category);
    if (propertyType) query = query.eq('property_type', propertyType); // Base property_type
    if (location) query = query.ilike('location', `%${location}%`);
    if (minPrice !== undefined) query = query.gte('price', minPrice);
    if (maxPrice !== undefined) query = query.lte('price', maxPrice);
    if (user_id) query = query.eq('user_id', user_id);
    if (agent_id) query = query.eq('agent_id', agent_id);
    if (status && status !== 'all') query = query.eq('status', status);

    // Filters on coalesced/detail fields from the view
    if (bedrooms !== undefined) query = query.gte('effective_bedrooms', bedrooms);
    if (bathrooms !== undefined) query = query.gte('effective_bathrooms', bathrooms);
    if (garages !== undefined) query = query.gte('effective_garages', garages); // House only via view logic
    if (house_parkings !== undefined) query = query.gte('effective_house_parkings', house_parkings); // House only via view logic
    if (parking_spaces !== undefined) query = query.gte('effective_parking_spaces', parking_spaces); // Apt/Comm via view logic

    // Land filters (use specific view columns)
    if (min_size_sqm !== undefined) query = query.gte('land_size_sqm', min_size_sqm); // Assuming view has land_size_sqm
    if (max_size_sqm !== undefined) query = query.lte('land_size_sqm', max_size_sqm);
    if (legal_status) query = query.eq('land_legal_status', legal_status);
    if (intended_use) query = query.eq('land_intended_use', intended_use);
    if (road_access !== undefined) query = query.eq('land_road_access', road_access);
    if (water_supply) query = query.eq('land_water_supply', water_supply);
    if (electricity_available !== undefined) query = query.eq('land_electricity_available', electricity_available);
    if (fenced !== undefined) query = query.eq('land_fenced', fenced);

    // Commercial filters
    if (commercial_property_type) query = query.eq('commercial_property_type_detail', commercial_property_type);
    // Add square meter filters if needed, using effective_square_meters

    // Apply Sorting on view columns
    try {
        const [sortFieldInput, sortOrderInput = 'desc'] = sort.split('.');
        const sortOrder = sortOrderInput.toLowerCase() === 'asc' ? 'asc' : 'desc';
        let sortColumn = sortFieldInput;

        // Map DTO sort fields to view column names if necessary
        const sortColumnMapping: Record<string, string> = {
            created_at: 'created_at',
            price: 'price',
            title: 'title',
            bedrooms: 'effective_bedrooms',
            bathrooms: 'effective_bathrooms',
            garages: 'effective_garages',
            parkings: 'effective_house_parkings', // Or decide which parking to sort by default
            parking_spaces: 'effective_parking_spaces',
            size_sqm: 'land_size_sqm', // Or effective_square_meters
            square_meters: 'effective_square_meters',
            status: 'status',
            // Add other mappings as needed
        };

        sortColumn = sortColumnMapping[sortFieldInput] || 'created_at'; // Default to created_at if mapping fails

        query = query.order(sortColumn, {
            ascending: sortOrder === 'asc',
            nullsFirst: false, // Or true, depending on desired behavior
        });
    } catch (e) {
        this.logger.warn(`Failed to parse sort parameter: ${sort}. Defaulting to created_at.desc`);
        query = query.order('created_at', { ascending: false, nullsFirst: false });
    }


    // Apply Pagination
    query = query.range(from, to);

    this.logger.log(`Executing Supabase query for properties view`);

    // Execute Query
    const { data, error, count } = await query;

    if (error) {
      this.logger.error(`Error fetching properties from view: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to retrieve properties: ${error.message}`);
    }

    // Map results (data is flatter now)
    const properties: Property[] = (data || []).map((viewRow: any) => {
      // You might need to reconstruct the 'details' object if your frontend strictly expects it,
      // or adjust the frontend to consume the flatter structure.
      // Example reconstructing details (optional):
      let details: any = {};
      switch (viewRow.category) {
          case 'house':
              details = { bedrooms: viewRow.effective_bedrooms, bathrooms: viewRow.effective_bathrooms, garages: viewRow.effective_garages, parkings: viewRow.effective_house_parkings /*, amenities, security_features */ };
              break;
          case 'land':
              details = { size_sqm: viewRow.land_size_sqm, legal_status: viewRow.land_legal_status, intended_use: viewRow.land_intended_use, road_access: viewRow.land_road_access, water_supply: viewRow.land_water_supply, electricity_available: viewRow.land_electricity_available, fenced: viewRow.land_fenced };
              break;
          // ... add cases for apartment, commercial
      }
       Object.keys(details).forEach(key => details[key] == null && delete details[key]);


      // Return the Property structure
      return {
        id: viewRow.id,
        title: viewRow.title,
        price: viewRow.price,
        location: viewRow.location,
        images: viewRow.images,
        coordinates: viewRow.coordinates,
        description: viewRow.description,
        property_type: viewRow.property_type,
        category: viewRow.category,
        user_id: viewRow.user_id,
        agent_id: viewRow.agent_id,
        created_at: viewRow.created_at,
        status: viewRow.status,
        last_updated: viewRow.last_updated,
        // Include base bedrooms/bathrooms ONLY if they still exist and are needed
        // bedrooms: viewRow.effective_bedrooms, // Or keep separate
        // bathrooms: viewRow.effective_bathrooms, // Or keep separate
        details: Object.keys(details).length > 0 ? details : undefined, // Reconstructed details
        // liked: false // Needs separate logic
      } as Property;
    });

    return {
      properties,
      total: count ?? 0, // Use the count returned by Supabase
      page: Number(page),
      pageSize: Number(pageSize),
    };
  }

  // --- Find One Method (Keep as is) ---
  async findOne(id: string): Promise<Property> {
    // ... (your existing findOne implementation)
    if (!id) {
      throw new BadRequestException("Property ID cannot be empty");
    }
    this.logger.log(`Finding property with ID: ${id}`);

    // 1. Fetch base property + status relationship
    const { data: baseProperty, error: baseError } = await this.supabase
      .from(this.baseTableName)
      .select("*, property_status(status, last_updated)") // Fetch status via relationship
      .eq("id", id)
      .maybeSingle();

    if (baseError) {
      this.logger.error(
        `Error fetching base property ${id}: ${baseError.message}`,
        baseError.stack,
      );
      throw new InternalServerErrorException(
        `Failed to retrieve property: ${baseError.message}`,
      );
    }

    if (!baseProperty) {
      throw new NotFoundException(`Property with ID ${id} not found`);
    }

    // Extract status details if relationship worked
    // Type assertion needed as Supabase types might not fully reflect relationship data
    const statusDetails = (baseProperty as any).property_status;
    delete (baseProperty as any).property_status; // Clean up relation data

    // 2. Fetch details based on category
    let detailsData = null;
    const detailTableName = this.getDetailTableName(baseProperty.category);

    if (detailTableName) {
      this.logger.log(
        `Fetching details from ${detailTableName} for property ${id}`,
      );
      const { data: detailsResult, error: detailError } = await this.supabase
        .from(detailTableName)
        .select("*")
        .eq("property_id", id)
        .maybeSingle();

      if (detailError) {
        // Log error but don't necessarily fail the whole request, maybe just return without details
        this.logger.error(
          `Error fetching details from ${detailTableName} for property ${id}: ${detailError.message}`,
          detailError.stack,
        );
      } else if (detailsResult) {
        const { property_id, ...restOfDetails } = detailsResult; // Exclude FK
        if (Object.keys(restOfDetails).length > 0) {
          detailsData = restOfDetails;
        }
      }
    }

    // 3. Combine base, status, and details
    return {
      ...baseProperty,
      status: statusDetails?.status,
      last_updated: statusDetails?.last_updated,
      details: detailsData || undefined,
    } as Property;
  }

  // --- Update Method (Keep as is) ---
  async update(
    id: string,
    updatePropertyDto: UpdatePropertyDto,
  ): Promise<Property> {
    // ... (your existing update implementation)
    if (!id) {
      throw new BadRequestException("Property ID cannot be empty");
    }
    const { details, ...baseUpdates } = updatePropertyDto;
    this.logger.log(`Attempting to update property ID: ${id}`);

    // Determine current category if baseUpdates doesn't include it but details are present
    let currentCategory = baseUpdates.category;
    if (
      details &&
      Object.keys(details).length > 0 &&
      !baseUpdates.category
    ) {
      // Fetch current property to get category if not provided in update DTO
      const currentProperty = await this.findOne(id); // Use findOne to get current state
      currentCategory = currentProperty.category;
    }

    // Update base properties if any
    if (Object.keys(baseUpdates).length > 0) {
      this.logger.log(`Updating base properties for ID: ${id}`);
      const { data: updatedBase, error: baseUpdateError } =
        await this.supabase
          .from(this.baseTableName)
          .update(baseUpdates)
          .eq("id", id)
          .select()
          .single();

      if (baseUpdateError) {
        this.logger.error(
          `Error updating base property ${id}: ${baseUpdateError.message}`,
          baseUpdateError.stack,
        );
        throw new InternalServerErrorException(
          `Failed to update base property: ${baseUpdateError.message}`,
        );
      }
      if (!updatedBase) {
        // This case might indicate the ID didn't exist, though findOne should catch it earlier
        throw new NotFoundException(
          `Property with ID ${id} not found during base update.`,
        );
      }
      this.logger.log(`Base properties updated for ID: ${id}`);
    }

    // Update details properties if any and category is known
    const detailTableName = currentCategory
      ? this.getDetailTableName(currentCategory)
      : null;

    if (details && Object.keys(details).length > 0 && detailTableName) {
      this.logger.log(`Updating details in ${detailTableName} for ID: ${id}`);
      // Use upsert for details? Or update? Update assumes record exists.
      const { error: detailUpdateError } = await this.supabase
        .from(detailTableName)
        .update(details)
        .eq("property_id", id); // Match on FK

      if (detailUpdateError) {
        // Log error, but maybe don't throw? Depends on desired behavior.
        this.logger.error(
          `Error updating details in ${detailTableName} for property ${id}: ${detailUpdateError.message}`,
          detailUpdateError.stack,
        );
        // Consider if partial success is acceptable or if you should throw
        // throw new InternalServerErrorException(`Failed to update property details: ${detailUpdateError.message}`);
      } else {
        this.logger.log(`Details updated in ${detailTableName} for ID: ${id}`);
      }
    } else if (
      details &&
      Object.keys(details).length > 0 &&
      !detailTableName
    ) {
      this.logger.warn(
        `Details provided for update on property ${id}, but no detail table found for category ${currentCategory}.`,
      );
    }

    // Refetch the updated property to return the combined state
    return this.findOne(id);
  }

  // --- Remove Method (Keep as is) ---
  async remove(id: string): Promise<void> {
    // ... (your existing remove implementation)
    if (!id) {
      throw new BadRequestException("Property ID cannot be empty");
    }
    this.logger.log(`Attempting to remove property ID: ${id}`);

    // Note: RLS policies on related tables (details, status, saved_properties)
    // and CASCADE constraints handle deletion there.
    // We only need to delete from the base 'properties' table.

    const { error, count } = await this.supabase
      .from(this.baseTableName)
      .delete({ count: "exact" }) // Get count to check if it existed
      .eq("id", id);

    if (error) {
      this.logger.error(
        `Error removing property ${id}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Failed to remove property: ${error.message}`,
      );
    }

    if (count === 0) {
      // Changed from NotFoundException to avoid throwing if delete is idempotent
      this.logger.warn(
        `Property with ID ${id} not found for deletion or already deleted.`,
      );
      // throw new NotFoundException(
      //   `Property with ID ${id} not found for deletion.`,
      // );
    } else {
      this.logger.log(`Property ID: ${id} removed successfully.`);
    }
  }
}
