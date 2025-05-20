import {
  Injectable,
  Inject,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants'; // Adjust path if needed
import { CreatePropertyDto } from './dto/create-property.dto';
import { QueryPropertyDto } from './dto/query-property.dto';
import { PropertyResponseDto, Property } from './dto/property.response.dto'; // Or your store path
import { UpdatePropertyDto } from './dto/update-property.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service'; // Adjust path if needed

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);
  private readonly baseTableName = 'properties';

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  private getDetailTableName(category: string): string | null {
    const validCategories = ['house', 'land', 'apartment', 'commercial'];
    if (validCategories.includes(category)) {
      return `property_details_${category}`;
    }
    this.logger.warn(`No detail table defined for category: ${category}`);
    return null;
  }

  async findPromoted(): Promise<Property[]> {
    this.logger.log('Fetching promoted properties');
    const { data, error } = await this.supabase
      .from('properties_view') // Assuming this view correctly joins and provides all necessary fields
      .select('*')
      .eq('is_promoted', true)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching promoted properties: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to retrieve promoted properties',
      );
    }

    const mappedProperties: Property[] = (data || []).map((viewRow: any) => {
      // Destructure all fields from the view, including those that form 'details'
      const {
        // Base property fields from 'properties' table (expected in view)
        id,
        title,
        price,
        location,
        images, // This should be the array of Cloudinary URLs from the 'properties' table
        coordinates,
        description,
        property_type,
        category,
        user_id,
        agent_id,
        created_at,
        status, // Assuming status comes from a join or is directly on properties_view
        last_updated, // Same as status
        is_promoted,

        // Detail fields (prefixed as they appear in your 'properties_view' based on previous context)
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
        // apt_bedrooms, apt_bathrooms are covered by effective_bedrooms/bathrooms
        apt_amenities,
        apt_parking_spaces,
        apt_security_features,
        comm_property_type, // This is the specific type for commercial like 'Office', 'Retail'
        comm_square_meters,
        comm_parking_spaces,
        comm_amenities,
        comm_security_features,
        // ... any other fields from your view ...
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
            bedrooms: effective_bedrooms, // Assuming effective_bedrooms covers apartments
            bathrooms: effective_bathrooms, // Assuming effective_bathrooms covers apartments
            square_meters: apt_square_meters,
            amenities: apt_amenities,
            parking_spaces: apt_parking_spaces,
            security_features: apt_security_features,
          };
          break;
        case 'commercial':
          details = {
            property_type: comm_property_type, // This is the detail field for commercial type
            square_meters: comm_square_meters,
            parking_spaces: comm_parking_spaces,
            amenities: comm_amenities,
            security_features: comm_security_features,
          };
          break;
      }
      // Remove null/undefined detail fields
      Object.keys(details).forEach(
        (key) => (details[key] === null || details[key] === undefined) && delete details[key],
      );

      return {
        id, title, price, location, images, coordinates, description,
        property_type, // This is 'rent' or 'sale'
        category, user_id, agent_id, created_at, status, last_updated,
        details: Object.keys(details).length > 0 ? details : undefined,
        is_promoted,
      } as Property;
    });

    const uniquePropertiesMap = new Map<string, Property>();
    mappedProperties.forEach((p) => {
      uniquePropertiesMap.set(p.id, p);
    });
    const uniquePropertiesArray = Array.from(uniquePropertiesMap.values());
    this.logger.log(`Returning ${uniquePropertiesArray.length} unique promoted properties.`);
    return uniquePropertiesArray;
  }

  async create(
    createPropertyDto: CreatePropertyDto,
    files?: Array<Express.Multer.File>,
  ): Promise<Property> {

    const { details, ...baseDataFromDto } = createPropertyDto;
    this.logger.log(
      `Attempting to create base property for category: ${baseDataFromDto.category}`,
    );
    this.logger.debug(`DTO received in service: ${JSON.stringify(createPropertyDto)}`);

    const baseDataToInsert: any = { ...baseDataFromDto };

    const uploadedCloudinaryUrls: string[] = [];
    if (files && files.length > 0) {
      this.logger.log(`Uploading ${files.length} images to Cloudinary.`);
      for (const file of files) {
        try {
          const uploadResult = await this.cloudinaryService.uploadImage(file);
          uploadedCloudinaryUrls.push(uploadResult.secure_url);
        } catch (error: any) {
          this.logger.error(`Failed to upload image to Cloudinary: ${error.message}`, error.stack);
          throw new InternalServerErrorException(`Image upload to Cloudinary failed: ${error.message}`);
        }
      }
    }
    baseDataToInsert.images = uploadedCloudinaryUrls;

    this.logger.debug(`Data for Supabase insert (properties): ${JSON.stringify(baseDataToInsert)}`);

    const { data: newBaseProperty, error: baseError } = await this.supabase
      .from(this.baseTableName)
      .insert(baseDataToInsert)
      .select()
      .single();

    if (baseError || !newBaseProperty) {
      this.logger.error(
        `Error creating base property in Supabase: ${baseError?.message}`,
        baseError?.stack,
      );
      if (uploadedCloudinaryUrls.length > 0) {
        this.logger.warn('Rolling back Cloudinary uploads due to DB error.');
        for (const url of uploadedCloudinaryUrls) {
            const publicId = this.cloudinaryService.getPublicIdFromUrl(url);
            if (publicId) {
                try { await this.cloudinaryService.deleteImage(publicId); }
                catch (e: any) { this.logger.error(`Failed to delete rolled back Cloudinary image ${publicId}: ${e.message}`);}
            }
        }
      }
      throw new InternalServerErrorException(
        `Failed to create base property in Supabase: ${baseError?.message || 'Unknown error'}`,
      );
    }
    this.logger.log(`Base property created with ID: ${newBaseProperty.id}`);

    const detailTableName = this.getDetailTableName(baseDataFromDto.category);
    if (details && Object.keys(details).length > 0 && detailTableName) {
      this.logger.log(
        `Inserting details into ${detailTableName} for property ${newBaseProperty.id}`,
      );
      this.logger.debug(`Details for Supabase insert (${detailTableName}): ${JSON.stringify({ ...details, property_id: newBaseProperty.id })}`);
      const { error: detailError } = await this.supabase
        .from(detailTableName)
        .insert({ ...details, property_id: newBaseProperty.id });

      if (detailError) {
        this.logger.error(
          `Error inserting property details into ${detailTableName}: ${detailError.message}. Rolling back.`,
          detailError.stack,
        );
        await this.supabase
          .from(this.baseTableName)
          .delete()
          .eq('id', newBaseProperty.id);
        if (uploadedCloudinaryUrls.length > 0) {
            for (const url of uploadedCloudinaryUrls) {
                const publicId = this.cloudinaryService.getPublicIdFromUrl(url);
                if (publicId) {
                    try { await this.cloudinaryService.deleteImage(publicId); }
                    catch (e: any) { this.logger.error(`Failed to delete rolled back Cloudinary image ${publicId}: ${e.message}`);}
                }
            }
        }
        throw new InternalServerErrorException(
          `Failed to insert property details: ${detailError.message}`,
        );
      }
      this.logger.log(`Details inserted successfully into ${detailTableName}`);
    } else if (details && Object.keys(details).length > 0 && !detailTableName) {
      this.logger.warn(
        `Details provided for property ${newBaseProperty.id}, but no detail table found for category ${baseDataFromDto.category}. Details not saved.`,
      );
    } else if (details && Object.keys(details).length === 0) {
        this.logger.log(`No details provided or details object was empty for property ${newBaseProperty.id}. Skipping detail insertion.`);
    }


    return this.findOne(newBaseProperty.id);
  }

  async findAll(queryDto: QueryPropertyDto): Promise<PropertyResponseDto> {
    // ... (findAll implementation from previous correct version)
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
        is_promoted,
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
        (key) => (details[key] === null || details[key] === undefined) && delete details[key],
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
        is_promoted,
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

    const { data: basePropertyData, error: baseError } = await this.supabase
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

    if (!basePropertyData) {
      throw new NotFoundException(`Property with ID ${id} not found`);
    }

    // Separate status details if they came as a nested object
    const { property_status, ...propertyFields } = basePropertyData as any;
    const statusInfo = Array.isArray(property_status) ? property_status[0] : property_status;


    let detailsData: any = null; // Initialize as null
    const detailTableName = this.getDetailTableName(propertyFields.category);

    if (detailTableName) {
      this.logger.log(
        `Fetching details from ${detailTableName} for property ${id}`,
      );
      const { data: detailsResult, error: detailError } = await this.supabase
        .from(detailTableName)
        .select('*')
        .eq('property_id', id)
        .maybeSingle(); // Use maybeSingle as details might not exist

      if (detailError) {
        this.logger.error(
          `Error fetching details from ${detailTableName} for property ${id}: ${detailError.message}`,
          // Do not throw here, property might exist without details or details table might be empty for this ID
        );
      } else if (detailsResult) {
        const { property_id: detailPropertyId, ...restOfDetails } = detailsResult; // Exclude property_id from details object
        if (Object.keys(restOfDetails).length > 0) {
          detailsData = restOfDetails;
        }
      }
    }

    // Construct the final Property object
    const finalProperty: Property = { // <<< Explicitly typing here can help catch issues
      ...(propertyFields as Omit<typeof propertyFields, 'property_status'>), // Spread known fields
      id: propertyFields.id, // Ensure all required Property fields are present
      title: propertyFields.title,
      price: propertyFields.price,
      location: propertyFields.location,
      images: propertyFields.images || [], // <<< Default to empty array if null/undefined from DB
      property_type: propertyFields.property_type,
      category: propertyFields.category,
      user_id: propertyFields.user_id,
      created_at: propertyFields.created_at,
      coordinates: propertyFields.coordinates,
      description: propertyFields.description,
      agent_id: propertyFields.agent_id,
      status: statusInfo?.status,
      last_updated: statusInfo?.last_updated,
      details: detailsData || undefined,
      is_promoted: propertyFields.is_promoted,
    };
    return finalProperty;
  }

  async update(
    id: string,
    updatePropertyDto: UpdatePropertyDto,
    newFiles?: Array<Express.Multer.File>,
  ): Promise<Property> {
    if (!id) {
      throw new BadRequestException('Property ID cannot be empty');
    }

    const {
        details,
        existingImageUrls = [], // Default to empty array if not provided
        deletedImagePublicIds = [], // Default to empty array
        // 'images' is not taken from updatePropertyDto directly for the final URL list
        ...baseUpdatesFromDto
    } = updatePropertyDto;

    this.logger.log(`Attempting to update property ID: ${id}`);
    this.logger.debug(`Update DTO: ${JSON.stringify(updatePropertyDto)}`);


    const currentProperty: Property = await this.findOne(id);

    let finalImageUrls: string[] = Array.isArray(updatePropertyDto.existingImageUrls) && updatePropertyDto.existingImageUrls.length > 0
                                   ? [...updatePropertyDto.existingImageUrls]
                                   : (currentProperty.images || []);


    if (Array.isArray(deletedImagePublicIds) && deletedImagePublicIds.length > 0) {
      this.logger.log(`Deleting ${deletedImagePublicIds.length} images from Cloudinary.`);
      for (const publicId of deletedImagePublicIds) {
        if (typeof publicId === 'string' && publicId.trim() !== '') {
            try {
              await this.cloudinaryService.deleteImage(publicId);
              finalImageUrls = finalImageUrls.filter(url => {
                const pidFromUrl = this.cloudinaryService.getPublicIdFromUrl(url);
                return pidFromUrl !== publicId;
              });
            } catch (error: any) {
              this.logger.error(`Failed to delete image ${publicId} from Cloudinary: ${error.message}`);
            }
        }
      }
    }

    const newUploadedCloudinaryUrls: string[] = [];
    if (newFiles && newFiles.length > 0) {
      this.logger.log(`Uploading ${newFiles.length} new images to Cloudinary.`);
      for (const file of newFiles) {
        try {
          const uploadResult = await this.cloudinaryService.uploadImage(file);
          newUploadedCloudinaryUrls.push(uploadResult.secure_url);
        } catch (error: any) {
          this.logger.error(`Failed to upload new image to Cloudinary: ${error.message}`);
          throw new InternalServerErrorException(`New image upload to Cloudinary failed: ${error.message}`);
        }
      }
    }
    finalImageUrls = [...finalImageUrls, ...newUploadedCloudinaryUrls];

    // Prepare the object for updating the 'properties' table
    const baseUpdatesToApply: any = { ...baseUpdatesFromDto };
    baseUpdatesToApply.images = finalImageUrls; // Set the final array of Cloudinary URLs

    // Determine category for detail table update (either from DTO or current property)
    const categoryForDetailUpdate = baseUpdatesFromDto.category || currentProperty.category;

    if (Object.keys(baseUpdatesToApply).length > 0) {
      this.logger.log(`Updating base properties for ID: ${id} in Supabase`);
      this.logger.debug(`Data for Supabase update (properties): ${JSON.stringify(baseUpdatesToApply)}`);
      const { data: updatedBase, error: baseUpdateError } = await this.supabase
        .from(this.baseTableName)
        .update(baseUpdatesToApply)
        .eq('id', id)
        .select() // Select to confirm update and get potentially modified data
        .single();

      if (baseUpdateError) {
        this.logger.error(
          `Error updating base property ${id} in Supabase: ${baseUpdateError.message}`,
          baseUpdateError.stack,
        );
        throw new InternalServerErrorException(
          `Failed to update base property in Supabase: ${baseUpdateError.message}`,
        );
      }
      if (!updatedBase) {
        // Should be caught by findOne earlier, but as a safeguard
        throw new NotFoundException(
          `Property with ID ${id} not found during Supabase base update.`,
        );
      }
      this.logger.log(`Base properties updated for ID: ${id} in Supabase`);
    }

    const detailTableName = this.getDetailTableName(categoryForDetailUpdate);
    if (details && Object.keys(details).length > 0 && detailTableName) {
      this.logger.log(`Updating/inserting details in ${detailTableName} for property ID: ${id}`);
      this.logger.debug(`Details for Supabase upsert (${detailTableName}): ${JSON.stringify({ ...details, property_id: id })}`);

      // Use upsert for details: update if exists, insert if not.
      // This requires 'property_id' to be a unique constraint or part of PK in detail tables.
      const { error: detailUpsertError } = await this.supabase
        .from(detailTableName)
        .upsert({ ...details, property_id: id }, { onConflict: 'property_id' });


      if (detailUpsertError) {
        this.logger.error(
          `Error upserting details in ${detailTableName} for property ${id}: ${detailUpsertError.message}`,
          detailUpsertError.stack,
        );
        // Decide on error handling: maybe log and continue, or throw if details are critical
      } else {
        this.logger.log(`Details upserted in ${detailTableName} for ID: ${id}`);
      }
    } else if (details && Object.keys(details).length > 0 && !detailTableName) {
      this.logger.warn(
        `Details provided for update on property ${id}, but no detail table found for category ${categoryForDetailUpdate}. Details not saved.`,
      );
    }

    return this.findOne(id); // Return the fully updated property
  }

  async remove(id: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('Property ID cannot be empty');
    }
    this.logger.log(`Attempting to remove property ID: ${id}`);

    const propertyToRemove: Property = await this.findOne(id);

    if (propertyToRemove.images && propertyToRemove.images.length > 0) {
      this.logger.log(`Deleting ${propertyToRemove.images.length} images from Cloudinary for property ${id}.`);
      for (const imageUrl of propertyToRemove.images) {
        const publicId = this.cloudinaryService.getPublicIdFromUrl(imageUrl);
        if (publicId) {
          try {
            await this.cloudinaryService.deleteImage(publicId);
          } catch (error: any) {
            this.logger.error(`Failed to delete image ${publicId} from Cloudinary: ${error.message}`);
          }
        }
      }
    }

    // Note: Deletion from detail tables should be handled by CASCADE DELETE in Supabase schema if set up.
    // Otherwise, you'd need to delete from detail tables manually here before deleting from the base table.
    const { error, count } = await this.supabase
      .from(this.baseTableName)
      .delete({ count: 'exact' }) // Ensure count is requested for feedback
      .eq('id', id);

    if (error) {
      this.logger.error(
        `Error removing property ${id} from Supabase: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Failed to remove property from Supabase: ${error.message}`,
      );
    }

    if (count === 0) {
      // This should ideally be caught by findOne, but as a safeguard.
      throw new NotFoundException(`Property with ID ${id} not found for deletion in Supabase.`);
    }
    this.logger.log(`Property ID: ${id} removed successfully from Supabase.`);
  }
}
