import {
  Injectable,
  Inject,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants';
import { CreatePropertyDto } from './dto/create-property.dto';
import { QueryPropertyDto } from './dto/query-property.dto';
import { PropertyResponseDto, Property } from './dto/property.response.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);
  private readonly baseTableName = 'properties';

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  private getDetailTableName(category: string): string | null {
    const validCategories = ['house', 'land', 'apartment', 'commercial'];
    if (validCategories.includes(category)) {
      return `property_details_${category}`;
    }
    this.logger.warn(`No detail table defined for category: ${category}`);
    return null;
  }

  async create(createPropertyDto: CreatePropertyDto): Promise<Property> {
    const { details, ...baseData } = createPropertyDto;
    this.logger.log(
      `Attempting to create base property for category: ${baseData.category}`,
    );

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
        `Failed to create base property: ${baseError?.message || 'Unknown error'}`,
      );
    }
    this.logger.log(`Base property created with ID: ${newBaseProperty.id}`);

    const detailTableName = this.getDetailTableName(baseData.category);
    if (details && Object.keys(details).length > 0 && detailTableName) {
      this.logger.log(
        `Inserting details into ${detailTableName} for property ${newBaseProperty.id}`,
      );
      const { error: detailError } = await this.supabase
        .from(detailTableName)
        .insert({ ...details, property_id: newBaseProperty.id });

      if (detailError) {
        this.logger.error(
          `Error inserting details into ${detailTableName}: ${detailError.message}. Rolling back base property.`,
          detailError.stack,
        );
        await this.supabase
          .from(this.baseTableName)
          .delete()
          .eq('id', newBaseProperty.id);
        throw new InternalServerErrorException(
          `Failed to insert property details: ${detailError.message}`,
        );
      }
      this.logger.log(`Details inserted successfully into ${detailTableName}`);
    } else if (details && Object.keys(details).length > 0 && !detailTableName) {
      this.logger.warn(
        `Details provided for property ${newBaseProperty.id}, but no detail table found for category ${baseData.category}.`,
      );
    }

    return newBaseProperty as Property;
  }

  async findAll(queryDto: QueryPropertyDto): Promise<PropertyResponseDto> {
    const {
      page = 1,
      pageSize = 10,
      sort = 'created_at.desc',
      category,
      propertyType,
      location,
      minPrice,
      maxPrice,
      bedrooms,
      bathrooms,
      garages,
      house_parkings,
      min_size_sqm,
      max_size_sqm,
      legal_status,
      intended_use,
      road_access,
      water_supply,
      electricity_available,
      fenced,
      parking_spaces,
      commercial_property_type,
      status,
      user_id,
      agent_id,
    } = queryDto;

    const offset = (page - 1) * pageSize;
    const from = offset;
    const to = offset + pageSize - 1;

    if (from < 0 || to < from) {
      return {
        properties: [],
        total: 0,
        page: Number(page),
        pageSize: Number(pageSize),
      };
    }

    let query = this.supabase
      .from('properties_view')
      .select('*', { count: 'exact' });

    if (category) query = query.eq('category', category);
    if (propertyType) query = query.eq('property_type', propertyType);
    if (location) query = query.ilike('location', `%${location}%`);
    if (minPrice !== undefined) query = query.gte('price', minPrice);
    if (maxPrice !== undefined) query = query.lte('price', maxPrice);
    if (user_id) query = query.eq('user_id', user_id);
    if (agent_id) query = query.eq('agent_id', agent_id);
    if (status && status !== 'all') query = query.eq('status', status);
    if (bedrooms !== undefined)
      query = query.gte('effective_bedrooms', bedrooms);
    if (bathrooms !== undefined)
      query = query.gte('effective_bathrooms', bathrooms);
    if (garages !== undefined) query = query.gte('effective_garages', garages);
    if (house_parkings !== undefined)
      query = query.gte('effective_house_parkings', house_parkings);
    if (parking_spaces !== undefined)
      query = query.gte('effective_parking_spaces', parking_spaces);
    if (min_size_sqm !== undefined)
      query = query.gte('land_size_sqm', min_size_sqm);
    if (max_size_sqm !== undefined)
      query = query.lte('land_size_sqm', max_size_sqm);
    if (legal_status) query = query.eq('land_legal_status', legal_status);
    if (intended_use) query = query.eq('land_intended_use', intended_use);
    if (road_access !== undefined)
      query = query.eq('land_road_access', road_access);
    if (water_supply) query = query.eq('land_water_supply', water_supply);
    if (electricity_available !== undefined)
      query = query.eq('land_electricity_available', electricity_available);
    if (fenced !== undefined) query = query.eq('land_fenced', fenced);
    if (commercial_property_type)
      query = query.eq(
        'commercial_property_type_detail',
        commercial_property_type,
      );

    query = query.order('is_promoted', { ascending: false });

    try {
      const [sortFieldInput, sortOrderInput = 'desc'] = sort.split('.');
      const sortOrder = sortOrderInput.toLowerCase() === 'asc' ? 'asc' : 'desc';
      let sortColumn = sortFieldInput;

      const sortColumnMapping: Record<string, string> = {
        created_at: 'created_at',
        price: 'price',
        title: 'title',
        bedrooms: 'effective_bedrooms',
        bathrooms: 'effective_bathrooms',
        garages: 'effective_garages',
        parkings: 'effective_house_parkings',
        parking_spaces: 'effective_parking_spaces',
        size_sqm: 'land_size_sqm',
        square_meters: 'effective_square_meters',
        status: 'status',
      };

      sortColumn = sortColumnMapping[sortFieldInput] || 'created_at';

      query = query.order(sortColumn, {
        ascending: sortOrder === 'asc',
        nullsFirst: false,
      });
    } catch (e) {
      this.logger.warn(
        `Failed to parse sort parameter: ${sort}. Defaulting to created_at.desc`,
      );
      query = query.order('created_at', {
        ascending: false,
        nullsFirst: false,
      });
    }

    query = query.range(from, to);

    this.logger.log(`Executing Supabase query for properties view`);

    const { data, error, count } = await query;

    if (error?.code === 'PGRST103') {
      return {
        properties: [],
        total: 0,
        page: Number(page),
        pageSize: Number(pageSize),
      };
    }

    if (error) {
      this.logger.error(
        `Error fetching properties from view: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Failed to retrieve properties: ${error.message}`,
      );
    }

    const properties: Property[] = (data || []).map((viewRow: any) => {
      const {
        effective_bedrooms,
        effective_bathrooms,
        house_garages,
        house_parkings,
        house_amenities,
        house_security_features,
        land_size_sqm,
        land_legal_status,
        land_intended_use,
        land_road_access,
        land_water_supply,
        land_electricity_available,
        land_fenced,
        apt_square_meters,
        apt_amenities,
        apt_parking_spaces,
        apt_security_features,
        comm_property_type,
        comm_square_meters,
        comm_parking_spaces,
        comm_amenities,
        comm_security_features,
        id,
        title,
        price,
        location,
        images,
        coordinates,
        description,
        property_type,
        category,
        user_id,
        agent_id,
        created_at,
        status,
        last_updated,
        is_promoted, // Include is_promoted from view
        promotion_expires_at, // Include expiry if needed
      } = viewRow;

      let details: any = {};
      switch (category) {
        case 'house':
          details = {
            bedrooms: effective_bedrooms,
            bathrooms: effective_bathrooms,
            garages: house_garages,
            parkings: house_parkings,
            amenities: house_amenities,
            security_features: house_security_features,
          };
          break;
        case 'land':
          details = {
            size_sqm: land_size_sqm,
            legal_status: land_legal_status,
            intended_use: land_intended_use,
            road_access: land_road_access,
            water_supply: land_water_supply,
            electricity_available: land_electricity_available,
            fenced: land_fenced,
          };
          break;
        case 'apartment':
          details = {
            bedrooms: effective_bedrooms,
            bathrooms: effective_bathrooms,
            square_meters: apt_square_meters,
            amenities: apt_amenities,
            parking_spaces: apt_parking_spaces,
            security_features: apt_security_features,
          };
          break;
        case 'commercial':
          details = {
            property_type: comm_property_type,
            square_meters: comm_square_meters,
            parking_spaces: comm_parking_spaces,
            amenities: comm_amenities,
            security_features: comm_security_features,
          };
          break;
      }
      Object.keys(details).forEach(
        (key) => details[key] == null && delete details[key],
      );

      return {
        id,
        title,
        price,
        location,
        images,
        coordinates,
        description,
        property_type,
        category,
        user_id,
        agent_id,
        created_at,
        status,
        last_updated,
        details: Object.keys(details).length > 0 ? details : undefined,
        is_promoted, // Add is_promoted flag
      } as Property;
    });

    return {
      properties,
      total: count ?? 0,
      page: Number(page),
      pageSize: Number(pageSize),
    };
  }

  async findOne(id: string): Promise<Property> {
    if (!id) {
      throw new BadRequestException('Property ID cannot be empty');
    }
    this.logger.log(`Finding property with ID: ${id}`);

    const { data: baseProperty, error: baseError } = await this.supabase
      .from(this.baseTableName)
      .select('*, property_status(status, last_updated)')
      .eq('id', id)
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

    const statusDetails = (baseProperty as any).property_status;
    delete (baseProperty as any).property_status;
    let detailsData = null;
    const detailTableName = this.getDetailTableName(baseProperty.category);

    if (detailTableName) {
      this.logger.log(
        `Fetching details from ${detailTableName} for property ${id}`,
      );
      const { data: detailsResult, error: detailError } = await this.supabase
        .from(detailTableName)
        .select('*')
        .eq('property_id', id)
        .maybeSingle();

      if (detailError) {
        this.logger.error(
          `Error fetching details from ${detailTableName} for property ${id}: ${detailError.message}`,
          detailError.stack,
        );
      } else if (detailsResult) {
        const { property_id, ...restOfDetails } = detailsResult;
        if (Object.keys(restOfDetails).length > 0) {
          detailsData = restOfDetails;
        }
      }
    }

    return {
      ...baseProperty,
      status: statusDetails?.status,
      last_updated: statusDetails?.last_updated,
      details: detailsData || undefined,
    } as Property;
  }

  async update(
    id: string,
    updatePropertyDto: UpdatePropertyDto,
  ): Promise<Property> {
    if (!id) {
      throw new BadRequestException('Property ID cannot be empty');
    }
    const { details, ...baseUpdates } = updatePropertyDto;
    this.logger.log(`Attempting to update property ID: ${id}`);

    let currentCategory = baseUpdates.category;
    if (details && Object.keys(details).length > 0 && !baseUpdates.category) {
      const currentProperty = await this.findOne(id);
      currentCategory = currentProperty.category;
    }

    if (Object.keys(baseUpdates).length > 0) {
      this.logger.log(`Updating base properties for ID: ${id}`);
      const { data: updatedBase, error: baseUpdateError } = await this.supabase
        .from(this.baseTableName)
        .update(baseUpdates)
        .eq('id', id)
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
        throw new NotFoundException(
          `Property with ID ${id} not found during base update.`,
        );
      }
      this.logger.log(`Base properties updated for ID: ${id}`);
    }

    const detailTableName = currentCategory
      ? this.getDetailTableName(currentCategory)
      : null;

    if (details && Object.keys(details).length > 0 && detailTableName) {
      this.logger.log(`Updating details in ${detailTableName} for ID: ${id}`);
      const { error: detailUpdateError } = await this.supabase
        .from(detailTableName)
        .update(details)
        .eq('property_id', id);
      if (detailUpdateError) {
        this.logger.error(
          `Error updating details in ${detailTableName} for property ${id}: ${detailUpdateError.message}`,
          detailUpdateError.stack,
        );
      } else {
        this.logger.log(`Details updated in ${detailTableName} for ID: ${id}`);
      }
    } else if (details && Object.keys(details).length > 0 && !detailTableName) {
      this.logger.warn(
        `Details provided for update on property ${id}, but no detail table found for category ${currentCategory}.`,
      );
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('Property ID cannot be empty');
    }
    this.logger.log(`Attempting to remove property ID: ${id}`);

    const { error, count } = await this.supabase
      .from(this.baseTableName)
      .delete({ count: 'exact' })
      .eq('id', id);

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
      this.logger.warn(
        `Property with ID ${id} not found for deletion or already deleted.`,
      );
    } else {
      this.logger.log(`Property ID: ${id} removed successfully.`);
    }
  }
}
