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
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';

const REGULAR_PROPERTIES_PER_AD = 7;
const RECENTLY_SHOWN_ADS_CACHE_KEY_PREFIX = 'user_promo_ads_cycle_';
const ADS_CYCLE_TTL_SECONDS = 15 * 60;

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);
  private readonly baseTableName = 'properties';

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly cloudinaryService: CloudinaryService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  private getDetailTableName(category: string): string | null {
    const validCategories = ['house', 'land', 'apartment', 'commercial'];
    if (validCategories.includes(category)) {
      return `property_details_${category}`;
    }
    this.logger.warn(`No detail table defined for category: ${category}`);
    return null;
  }

  private mapDbRowToProperty(viewRow: any): Property {
    const {
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
      contact_phone_number,
      contact_whatsapp_number,
      use_phone_for_call,
      use_whatsapp_for_message,
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
      (key) =>
        (details[key] === null || details[key] === undefined) &&
        delete details[key],
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
      contact_phone_number,
      contact_whatsapp_number,
      use_phone_for_call: use_phone_for_call === true,
      use_whatsapp_for_message: use_whatsapp_for_message === true,
    } as Property;
  }

  async findPromoted(): Promise<Property[]> {
    this.logger.log('Fetching promoted properties');
    const { data, error } = await this.supabase
      .from('properties_view')
      .select('*')
      .eq('is_promoted', true)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching promoted properties: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to retrieve promoted properties',
      );
    }
    const mappedProperties = (data || []).map(this.mapDbRowToProperty);
    const uniquePropertiesMap = new Map<string, Property>();
    mappedProperties.forEach((p) => uniquePropertiesMap.set(p.id, p));
    return Array.from(uniquePropertiesMap.values());
  }

  async findAll(queryDto: QueryPropertyDto): Promise<PropertyResponseDto> {
    const {
      page = 1,
      pageSize = 10,
      sort = 'created_at.desc',
      sessionId,
      ...filters
    } = queryDto;

    const effectiveSessionId = sessionId || 'anonymous_global_session';
    this.logger.debug(
      `Using effectiveSessionId: ${effectiveSessionId} for ad cycle. Page: ${page}`,
    );

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

    const buildBaseQuery = (isPromotedFilter?: boolean) => {
      let query = this.supabase
        .from('properties_view')
        .select('*', { count: 'exact' });

      if (isPromotedFilter !== undefined) {
        query = query.eq('is_promoted', isPromotedFilter);
      }

      if (filters.category && filters.category !== 'all')
        query = query.eq('category', filters.category);
      if (
        filters.propertyType &&
        (filters.propertyType === 'rent' || filters.propertyType === 'sale')
      )
        query = query.eq('property_type', filters.propertyType);
      if (filters.location) {
        const trimmedLocation = filters.location.trim().toLowerCase();
        if (trimmedLocation) {
          const searchConditions: string[] = [];

          searchConditions.push(`title.ilike.%${trimmedLocation}%`);
          searchConditions.push(`location.ilike.%${trimmedLocation}%`);

          const categoryMap: Record<string, string> = {
            house: 'house',
            houses: 'house',
            apartment: 'apartment',
            apartments: 'apartment',
            flat: 'apartment',
            flats: 'apartment',
            land: 'land',
            'vacant land': 'land',
            plot: 'land',
            plots: 'land',
            commercial: 'commercial',
            office: 'commercial',
            retail: 'commercial',
            shop: 'commercial',
            farm: 'farm',
            farms: 'farm',
            farming: 'farm',
            agricultural: 'farm',
            industrial: 'industrial',
            warehouse: 'industrial',
            factory: 'industrial',
            lodge: 'lodge',
            lodges: 'lodge',
            hotel: 'lodge',
            guesthouse: 'lodge',
          };

          const matchedCategory = categoryMap[trimmedLocation];
          if (matchedCategory) {
            searchConditions.push(`category.eq.${matchedCategory}`);
          }

          if (
            trimmedLocation.includes('rent') ||
            trimmedLocation.includes('rental')
          ) {
            searchConditions.push(`property_type.eq.rent`);
          }
          if (
            trimmedLocation.includes('sale') ||
            trimmedLocation.includes('buy')
          ) {
            searchConditions.push(`property_type.eq.sale`);
          }

          searchConditions.push(`house_amenities.cs.{${trimmedLocation}}`);
          searchConditions.push(`apt_amenities.cs.{${trimmedLocation}}`);
          searchConditions.push(`comm_amenities.cs.{${trimmedLocation}}`);

          searchConditions.push(
            `house_security_features.cs.{${trimmedLocation}}`,
          );
          searchConditions.push(
            `apt_security_features.cs.{${trimmedLocation}}`,
          );
          searchConditions.push(
            `comm_security_features.cs.{${trimmedLocation}}`,
          );

          const amenityVariations: Record<string, string[]> = {
            pool: ['Pool', 'Swimming Pool'],
            'swimming pool': ['Pool', 'Swimming Pool'],
            security: ['24hr Security', 'Security', 'Security Gate'],
            '24hr security': ['24hr Security', 'Security'],
            'security gate': ['Security Gate', 'Security'],
            garden: ['Garden'],
            garage: ['Garage'],
            parking: ['Parking'],
            internet: ['Fibre Internet'],
            fibre: ['Fibre Internet'],
            wifi: ['Fibre Internet'],
            'air conditioning': ['Air Conditioning'],
            aircon: ['Air Conditioning'],
            ac: ['Air Conditioning'],
            borehole: ['Borehole'],
            water: ['Water Connection', 'Borehole'],
            electricity: ['Electricity', 'Three Phase Power'],
            power: ['Electricity', 'Three Phase Power'],
            'boundary wall': ['Boundary Wall'],
            wall: ['Boundary Wall'],
            fenced: ['Fenced'],
            fence: ['Fenced'],
            'staff quarters': ['Staff Quarters'],
            quarters: ['Staff Quarters'],
          };

          const matchedAmenities = amenityVariations[trimmedLocation];
          if (matchedAmenities) {
            matchedAmenities.forEach((amenity) => {
              searchConditions.push(`house_amenities.cs.{${amenity}}`);
              searchConditions.push(`apt_amenities.cs.{${amenity}}`);
              searchConditions.push(`comm_amenities.cs.{${amenity}}`);
            });
          }

          // 7. Search in commercial property types
          const commercialTypes = [
            'Office',
            'Retail',
            'Warehouse',
            'Industrial',
            'Mixed-Use',
            'Restaurant',
          ];
          const matchedCommercialType = commercialTypes.find(
            (type) =>
              type.toLowerCase() === trimmedLocation ||
              type.toLowerCase().includes(trimmedLocation),
          );
          if (matchedCommercialType) {
            searchConditions.push(
              `comm_property_type.eq.${matchedCommercialType}`,
            );
          }

          // 8. Search in land details
          if (
            trimmedLocation.includes('residential') ||
            trimmedLocation.includes('commercial') ||
            trimmedLocation.includes('agricultural') ||
            trimmedLocation.includes('industrial')
          ) {
            searchConditions.push(
              `land_intended_use.ilike.%${trimmedLocation}%`,
            );
          }

          // 9. Search for bedroom/bathroom counts
          const bedroomMatch = trimmedLocation.match(
            /(\d+)\s*(bed|bedroom|br)/,
          );
          if (bedroomMatch) {
            const bedCount = parseInt(bedroomMatch[1]);
            searchConditions.push(`effective_bedrooms.gte.${bedCount}`);
          }

          const bathroomMatch = trimmedLocation.match(
            /(\d+)\s*(bath|bathroom|br)/,
          );
          if (bathroomMatch) {
            const bathCount = parseInt(bathroomMatch[1]);
            searchConditions.push(`effective_bathrooms.gte.${bathCount}`);
          }

          // Apply the OR condition with all search possibilities
          query = query.or(searchConditions.join(','));
        }
      }

      if (filters.minPrice !== undefined)
        query = query.gte('price', filters.minPrice);
      if (filters.maxPrice !== undefined)
        query = query.lte('price', filters.maxPrice);
      if (filters.user_id) query = query.eq('user_id', filters.user_id);
      if (filters.agent_id) query = query.eq('agent_id', filters.agent_id);
      if (filters.status && filters.status !== 'all')
        query = query.eq('status', filters.status);
      if (filters.bedrooms !== undefined && filters.bedrooms > 0)
        query = query.gte('effective_bedrooms', filters.bedrooms);
      if (filters.bathrooms !== undefined && filters.bathrooms > 0)
        query = query.gte('effective_bathrooms', filters.bathrooms);
      if (filters.garages !== undefined && filters.garages > 0)
        query = query.gte('house_garages', filters.garages);
      if (filters.house_parkings !== undefined && filters.house_parkings > 0)
        query = query.gte('house_parkings', filters.house_parkings);
      if (filters.parking_spaces !== undefined && filters.parking_spaces > 0)
        query = query.gte('effective_parking_spaces', filters.parking_spaces);
      if (filters.min_size_sqm !== undefined)
        query = query.gte('land_size_sqm', filters.min_size_sqm);
      if (filters.max_size_sqm !== undefined)
        query = query.lte('land_size_sqm', filters.max_size_sqm);
      if (filters.min_square_meters !== undefined)
        query = query.gte('effective_square_meters', filters.min_square_meters);
      if (filters.max_square_meters !== undefined)
        query = query.lte('effective_square_meters', filters.max_square_meters);
      if (filters.legal_status)
        query = query.eq('land_legal_status', filters.legal_status);
      if (filters.intended_use)
        query = query.eq('land_intended_use', filters.intended_use);
      if (filters.road_access !== undefined)
        query = query.eq('land_road_access', filters.road_access);
      if (filters.water_supply)
        query = query.eq('land_water_supply', filters.water_supply);
      if (filters.electricity_available !== undefined)
        query = query.eq(
          'land_electricity_available',
          filters.electricity_available,
        );
      if (filters.fenced !== undefined)
        query = query.eq('land_fenced', filters.fenced);
      if (filters.commercial_property_type)
        query = query.eq(
          'comm_property_type',
          filters.commercial_property_type,
        );

      return query;
    };

    // Fetch promoted ad candidates that match ALL search criteria
    const promotedAdCandidatesQuery = buildBaseQuery(true).order('created_at', {
      ascending: false,
    });

    const { data: promotedAdCandidatesData, error: promotedError } =
      await promotedAdCandidatesQuery;

    if (promotedError) {
      this.logger.error(
        `Error fetching promoted ad candidates: ${promotedError.message}`,
        promotedError.stack,
      );
    }

    const allPromotedAdsMasterList = (promotedAdCandidatesData || []).map(
      (p) => ({
        ...this.mapDbRowToProperty(p),
        isInjectedAd: true,
      }),
    );

    // Fetch ALL properties (both regular and promoted) that match the search criteria
    let allPropertiesQuery = buildBaseQuery(); // No promoted filter - gets both regular and promoted

    // Apply sorting
    try {
      const [sortFieldInput, sortOrderInput = 'desc'] = sort.split('.');
      const sortOrder = sortOrderInput.toLowerCase() === 'asc' ? 'asc' : 'desc';
      const sortColumnMapping: Record<string, string> = {
        created_at: 'created_at',
        price: 'price',
        title: 'title',
        bedrooms: 'effective_bedrooms',
        bathrooms: 'effective_bathrooms',
        garages: 'house_garages',
        parkings: 'house_parkings',
        parking_spaces: 'effective_parking_spaces',
        size_sqm: 'land_size_sqm',
        square_meters: 'effective_square_meters',
        status: 'status',
      };
      const sortColumn = sortColumnMapping[sortFieldInput] || 'created_at';
      allPropertiesQuery = allPropertiesQuery.order(sortColumn, {
        ascending: sortOrder === 'asc',
        nullsFirst: false,
      });
    } catch (e) {
      this.logger.warn(
        `Failed to parse sort parameter: ${sort}. Defaulting to created_at.desc`,
      );
      allPropertiesQuery = allPropertiesQuery.order('created_at', {
        ascending: false,
        nullsFirst: false,
      });
    }

    allPropertiesQuery = allPropertiesQuery.range(from, to);
    const {
      data: allPropertiesData,
      error: allPropertiesError,
      count: totalCount,
    } = await allPropertiesQuery;

    if (allPropertiesError?.code === 'PGRST103') {
      return {
        properties: [],
        total: 0,
        page: Number(page),
        pageSize: Number(pageSize),
      };
    }
    if (allPropertiesError) {
      this.logger.error(
        `Error fetching all properties: ${allPropertiesError.message}`,
        allPropertiesError.stack,
      );
      throw new InternalServerErrorException(
        `Failed to retrieve properties: ${allPropertiesError.message}`,
      );
    }

    // Map all properties and separate regular from promoted
    const allProperties: Property[] = (allPropertiesData || []).map((p) => ({
      ...this.mapDbRowToProperty(p),
      isInjectedAd: false,
    }));

    const regularProperties = allProperties.filter((p) => !p.is_promoted);
    const promotedPropertiesInResults = allProperties.filter(
      (p) => p.is_promoted,
    );

    const finalPropertiesList: Property[] = [];

    const userCategoryCacheKey = `${RECENTLY_SHOWN_ADS_CACHE_KEY_PREFIX}${effectiveSessionId}_${
      filters.category || 'all'
    }`;
    const userOffsetCacheKey = `${userCategoryCacheKey}_offset`;

    // If we have promoted ads available for injection and regular properties to inject them into
    if (allPromotedAdsMasterList.length > 0 && regularProperties.length > 0) {
      // Filter out ads that are already part of the current page's results
      const propertiesAlreadyInResults = new Set([
        ...regularProperties.map((p) => p.id),
        ...promotedPropertiesInResults.map((p) => p.id),
      ]);

      const eligibleAdsForInjection = allPromotedAdsMasterList.filter(
        (ad) => !propertiesAlreadyInResults.has(ad.id),
      );

      if (eligibleAdsForInjection.length > 0) {
        // Get current global ad cycle index
        let globalAdCycleIndex: number =
          (await this.cacheManager.get<number>(userOffsetCacheKey)) || 0;

        this.logger.debug(
          `Starting with global ad cycle index: ${globalAdCycleIndex} for session ${effectiveSessionId}`,
        );

        const adsInjectedThisPage = new Set<string>();
        let regularItemCounter = 0;

        // First, add all promoted properties that are already in results (they matched the search)
        promotedPropertiesInResults.forEach((promotedProp) => {
          finalPropertiesList.push(promotedProp);
        });

        // Then inject regular properties with ads
        for (const regularProp of regularProperties) {
          finalPropertiesList.push(regularProp);
          regularItemCounter++;

          // Inject ad after every REGULAR_PROPERTIES_PER_AD regular properties
          if (regularItemCounter % REGULAR_PROPERTIES_PER_AD === 0) {
            // Get the next ad in the cycle
            const adIndex = globalAdCycleIndex % eligibleAdsForInjection.length;
            const adToInject = eligibleAdsForInjection[adIndex];

            // Only inject if we haven't already used this ad on this page
            if (!adsInjectedThisPage.has(adToInject.id)) {
              finalPropertiesList.push(adToInject);
              adsInjectedThisPage.add(adToInject.id);

              this.logger.debug(
                `Injected ad ${adToInject.id} (index ${adIndex}) at position ${finalPropertiesList.length} for session ${effectiveSessionId}`,
              );
            }

            // Always advance the cycle index
            globalAdCycleIndex++;
          }
        }

        // Persist the updated global cycle index
        await this.cacheManager.set(
          userOffsetCacheKey,
          globalAdCycleIndex,
          ADS_CYCLE_TTL_SECONDS,
        );

        this.logger.debug(
          `Updated global ad cycle index to ${globalAdCycleIndex} for session ${effectiveSessionId}, category ${filters.category || 'all'}`,
        );
      } else {
        // No additional ads to inject, just return all properties
        finalPropertiesList.push(...allProperties);
      }
    } else {
      // No ads available for injection or no regular properties, just return all properties
      finalPropertiesList.push(...allProperties);
    }

    return {
      properties: finalPropertiesList,
      total: totalCount ?? 0,
      page: Number(page),
      pageSize: Number(pageSize),
    };
  }

  async create(
    createPropertyDto: CreatePropertyDto,
    files?: Array<Express.Multer.File>,
  ): Promise<Property> {
    const { details, ...baseDataFromDto } = createPropertyDto;
    this.logger.log(
      `Attempting to create base property for category: ${baseDataFromDto.category}`,
    );

    const baseDataToInsert: any = {
      title: baseDataFromDto.title,
      price: baseDataFromDto.price,
      location: baseDataFromDto.location,
      coordinates: baseDataFromDto.coordinates,
      description: baseDataFromDto.description,
      user_id: baseDataFromDto.user_id,
      agent_id: baseDataFromDto.agent_id,
      property_type: baseDataFromDto.property_type,
      category: baseDataFromDto.category,
      contact_phone_number: baseDataFromDto.contact_phone_number,
      contact_whatsapp_number: baseDataFromDto.contact_whatsapp_number,
      use_phone_for_call:
        baseDataFromDto.use_phone_for_call ??
        !!baseDataFromDto.contact_phone_number,
      use_whatsapp_for_message:
        baseDataFromDto.use_whatsapp_for_message ??
        !!baseDataFromDto.contact_whatsapp_number,
    };

    const uploadedCloudinaryUrls: string[] = [];
    if (files && files.length > 0) {
      this.logger.log(`Uploading ${files.length} images to Cloudinary.`);
      for (const file of files) {
        try {
          const uploadResult = await this.cloudinaryService.uploadImage(file);
          uploadedCloudinaryUrls.push(uploadResult.secure_url);
        } catch (error: any) {
          this.logger.error(
            `Failed to upload image to Cloudinary: ${error.message}`,
            error.stack,
          );
          throw new InternalServerErrorException(
            `Image upload to Cloudinary failed: ${error.message}`,
          );
        }
      }
    }
    baseDataToInsert.images = uploadedCloudinaryUrls;

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
            try {
              await this.cloudinaryService.deleteImage(publicId);
            } catch (e: any) {
              this.logger.error(
                `Failed to delete rolled back Cloudinary image ${publicId}: ${e.message}`,
              );
            }
          }
        }
      }
      throw new InternalServerErrorException(
        `Failed to create base property: ${
          baseError?.message || 'Unknown error'
        }`,
      );
    }
    this.logger.log(`Base property created with ID: ${newBaseProperty.id}`);

    const detailTableName = this.getDetailTableName(baseDataFromDto.category);
    if (details && Object.keys(details).length > 0 && detailTableName) {
      this.logger.log(
        `Inserting details into ${detailTableName} for property ${newBaseProperty.id}`,
      );
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
              try {
                await this.cloudinaryService.deleteImage(publicId);
              } catch (e: any) {
                this.logger.error(
                  `Failed to delete rolled back Cloudinary image ${publicId}: ${e.message}`,
                );
              }
            }
          }
        }
        throw new InternalServerErrorException(
          `Failed to insert property details: ${detailError.message}`,
        );
      }
      this.logger.log(`Details inserted successfully into ${detailTableName}`);
    }
    return this.findOne(newBaseProperty.id);
  }

  async findOne(id: string): Promise<Property> {
    if (!id) {
      throw new BadRequestException('Property ID cannot be empty');
    }
    this.logger.log(`Finding property with ID: ${id}`);
    const { data, error } = await this.supabase
      .from('properties_view')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Error fetching property ${id} from view: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Failed to retrieve property: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(`Property with ID ${id} not found`);
    }
    return this.mapDbRowToProperty(data);
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
      existingImageUrls = [],
      deletedImagePublicIds = [],
      ...baseUpdatesFromDto
    } = updatePropertyDto;

    this.logger.log(`Attempting to update property ID: ${id}`);
    const currentProperty: Property = await this.findOne(id);
    let finalImageUrls: string[] =
      Array.isArray(updatePropertyDto.existingImageUrls) &&
      updatePropertyDto.existingImageUrls.length > 0
        ? [...updatePropertyDto.existingImageUrls]
        : currentProperty.images || [];

    if (
      Array.isArray(deletedImagePublicIds) &&
      deletedImagePublicIds.length > 0
    ) {
      this.logger.log(
        `Deleting ${deletedImagePublicIds.length} images from Cloudinary.`,
      );
      for (const publicId of deletedImagePublicIds) {
        if (typeof publicId === 'string' && publicId.trim() !== '') {
          try {
            await this.cloudinaryService.deleteImage(publicId);
            finalImageUrls = finalImageUrls.filter((url) => {
              const pidFromUrl = this.cloudinaryService.getPublicIdFromUrl(url);
              return pidFromUrl !== publicId;
            });
          } catch (error: any) {
            this.logger.error(
              `Failed to delete image ${publicId} from Cloudinary: ${error.message}`,
            );
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
          this.logger.error(
            `Failed to upload new image to Cloudinary: ${error.message}`,
          );
          throw new InternalServerErrorException(
            `New image upload to Cloudinary failed: ${error.message}`,
          );
        }
      }
    }
    finalImageUrls = [...finalImageUrls, ...newUploadedCloudinaryUrls];

    const baseUpdatesToApply: any = { ...baseUpdatesFromDto };
    baseUpdatesToApply.images = finalImageUrls;

    if (baseUpdatesToApply.hasOwnProperty('use_phone_for_call')) {
      baseUpdatesToApply.use_phone_for_call =
        baseUpdatesToApply.use_phone_for_call ??
        !!baseUpdatesToApply.contact_phone_number;
    }
    if (baseUpdatesToApply.hasOwnProperty('use_whatsapp_for_message')) {
      baseUpdatesToApply.use_whatsapp_for_message =
        baseUpdatesToApply.use_whatsapp_for_message ??
        !!baseUpdatesToApply.contact_whatsapp_number;
    }

    const categoryForDetailUpdate =
      baseUpdatesFromDto.category || currentProperty.category;

    if (Object.keys(baseUpdatesToApply).length > 0) {
      this.logger.log(`Updating base properties for ID: ${id} in Supabase`);
      const { data: updatedBase, error: baseUpdateError } = await this.supabase
        .from(this.baseTableName)
        .update(baseUpdatesToApply)
        .eq('id', id)
        .select()
        .single();

      if (baseUpdateError) {
        this.logger.error(
          `Error updating base property ${id} in Supabase: ${baseUpdateError.message}`,
          baseUpdateError.stack,
        );
        throw new InternalServerErrorException(
          `Failed to update base property: ${baseUpdateError.message}`,
        );
      }
      if (!updatedBase) {
        throw new NotFoundException(
          `Property with ID ${id} not found during Supabase base update.`,
        );
      }
      this.logger.log(`Base properties updated for ID: ${id} in Supabase`);
    }

    const detailTableName = this.getDetailTableName(categoryForDetailUpdate);
    if (details && Object.keys(details).length > 0 && detailTableName) {
      this.logger.log(
        `Updating/inserting details in ${detailTableName} for property ID: ${id}`,
      );
      const { error: detailUpsertError } = await this.supabase
        .from(detailTableName)
        .upsert({ ...details, property_id: id }, { onConflict: 'property_id' });

      if (detailUpsertError) {
        this.logger.error(
          `Error upserting details in ${detailTableName} for property ${id}: ${detailUpsertError.message}`,
          detailUpsertError.stack,
        );
      } else {
        this.logger.log(`Details upserted in ${detailTableName} for ID: ${id}`);
      }
    }
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    if (!id) {
      throw new BadRequestException('Property ID cannot be empty');
    }
    this.logger.log(`Attempting to remove property ID: ${id}`);
    const propertyToRemove: Property = await this.findOne(id);

    if (propertyToRemove.images && propertyToRemove.images.length > 0) {
      this.logger.log(
        `Deleting ${propertyToRemove.images.length} images from Cloudinary for property ${id}.`,
      );
      for (const imageUrl of propertyToRemove.images) {
        const publicId = this.cloudinaryService.getPublicIdFromUrl(imageUrl);
        if (publicId) {
          try {
            await this.cloudinaryService.deleteImage(publicId);
          } catch (error: any) {
            this.logger.error(
              `Failed to delete image ${publicId} from Cloudinary: ${error.message}`,
            );
          }
        }
      }
    }

    const { error, count } = await this.supabase
      .from(this.baseTableName)
      .delete({ count: 'exact' })
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
      throw new NotFoundException(
        `Property with ID ${id} not found for deletion in Supabase.`,
      );
    }
    this.logger.log(`Property ID: ${id} removed successfully from Supabase.`);
  }
}
