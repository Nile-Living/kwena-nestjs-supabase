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
import { PropertyResponseDto, Property } from "./dto/property.response.dto";
import { UpdatePropertyDto } from "./dto/update-property.dto";
import { CloudinaryService } from "../cloudinary/cloudinary.service";

const REGULAR_PROPERTIES_PER_AD = 5; // Configurable: Show 1 ad after every 5 regular properties

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);
  private readonly baseTableName = "properties";

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  private getDetailTableName(category: string): string | null {
    const validCategories = ["house", "land", "apartment", "commercial"];
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
      comm_property_type, // This was commercial_property_type_detail in schema, ensure it matches view
      comm_square_meters,
      comm_parking_spaces,
      comm_amenities,
      comm_security_features,
    } = viewRow;

    let details: any = {};
    switch (category) {
      case "house":
        details = {
          bedrooms: effective_bedrooms,
          bathrooms: effective_bathrooms,
          garages: house_garages,
          parkings: house_parkings,
          amenities: house_amenities,
          security_features: house_security_features,
        };
        break;
      case "land":
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
      case "apartment":
        details = {
          bedrooms: effective_bedrooms,
          bathrooms: effective_bathrooms,
          square_meters: apt_square_meters,
          amenities: apt_amenities,
          parking_spaces: apt_parking_spaces,
          security_features: apt_security_features,
        };
        break;
      case "commercial":
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
    this.logger.log("Fetching promoted properties");
    const { data, error } = await this.supabase
      .from("properties_view")
      .select("*")
      .eq("is_promoted", true)
      .order("created_at", { ascending: false }); // Or some other relevant order for promoted

    if (error) {
      this.logger.error(`Error fetching promoted properties: ${error.message}`);
      throw new InternalServerErrorException(
        "Failed to retrieve promoted properties",
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
      sort = "created_at.desc",
      ...filters
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

    let adCandidatesQuery = this.supabase
      .from("properties_view")
      .select("*")
      .eq("is_promoted", true);
    if (filters.category && filters.category !== "all") {
      adCandidatesQuery = adCandidatesQuery.eq("category", filters.category);
    }
    adCandidatesQuery = adCandidatesQuery.order("created_at", {
      ascending: false,
    }); // Or a more sophisticated order for ads

    const { data: promotedAdCandidatesData, error: promotedError } =
      await adCandidatesQuery;

    if (promotedError) {
      this.logger.error(
        `Error fetching promoted ad candidates: ${promotedError.message}`,
        promotedError.stack,
      );
    }
    const promotedAdCandidates = (promotedAdCandidatesData || []).map((p) => ({
      ...this.mapDbRowToProperty(p),
      isInjectedAd: true,
    }));

    let regularQuery = this.supabase
      .from("properties_view")
      .select("*", { count: "exact" })
      .eq("is_promoted", false);

    if (filters.category && filters.category !== "all")
      regularQuery = regularQuery.eq("category", filters.category);
    if (filters.propertyType && (filters.propertyType === "rent" || filters.propertyType === "sale"))
      regularQuery = regularQuery.eq("property_type", filters.propertyType);
    if (filters.location)
      regularQuery = regularQuery.ilike("location", `%${filters.location}%`);
    if (filters.minPrice !== undefined)
      regularQuery = regularQuery.gte("price", filters.minPrice);
    if (filters.maxPrice !== undefined)
      regularQuery = regularQuery.lte("price", filters.maxPrice);
    if (filters.user_id)
      regularQuery = regularQuery.eq("user_id", filters.user_id);
    if (filters.agent_id)
      regularQuery = regularQuery.eq("agent_id", filters.agent_id);
    if (filters.status && filters.status !== "all")
      regularQuery = regularQuery.eq("status", filters.status);

    if (filters.bedrooms !== undefined && filters.bedrooms > 0)
      regularQuery = regularQuery.gte(
        "effective_bedrooms",
        filters.bedrooms,
      );
    if (filters.bathrooms !== undefined && filters.bathrooms > 0)
      regularQuery = regularQuery.gte(
        "effective_bathrooms",
        filters.bathrooms,
      );
    if (filters.garages !== undefined && filters.garages > 0)
      regularQuery = regularQuery.gte("house_garages", filters.garages);
    if (filters.house_parkings !== undefined && filters.house_parkings > 0)
      regularQuery = regularQuery.gte(
        "house_parkings",
        filters.house_parkings,
      );
    if (filters.parking_spaces !== undefined && filters.parking_spaces > 0)
      regularQuery = regularQuery.gte(
        "effective_parking_spaces",
        filters.parking_spaces,
      );
    if (filters.min_size_sqm !== undefined)
      regularQuery = regularQuery.gte("land_size_sqm", filters.min_size_sqm);
    if (filters.max_size_sqm !== undefined)
      regularQuery = regularQuery.lte("land_size_sqm", filters.max_size_sqm);
    if (filters.min_square_meters !== undefined)
      regularQuery = regularQuery.gte(
        "effective_square_meters",
        filters.min_square_meters,
      );
    if (filters.max_square_meters !== undefined)
      regularQuery = regularQuery.lte(
        "effective_square_meters",
        filters.max_square_meters,
      );

    if (filters.legal_status)
      regularQuery = regularQuery.eq("land_legal_status", filters.legal_status);
    if (filters.intended_use)
      regularQuery = regularQuery.eq(
        "land_intended_use",
        filters.intended_use,
      );
    if (filters.road_access !== undefined)
      regularQuery = regularQuery.eq("land_road_access", filters.road_access);
    if (filters.water_supply)
      regularQuery = regularQuery.eq("land_water_supply", filters.water_supply);
    if (filters.electricity_available !== undefined)
      regularQuery = regularQuery.eq(
        "land_electricity_available",
        filters.electricity_available,
      );
    if (filters.fenced !== undefined)
      regularQuery = regularQuery.eq("land_fenced", filters.fenced);
    if (filters.commercial_property_type)
      regularQuery = regularQuery.eq(
        "comm_property_type",
        filters.commercial_property_type,
      );

    try {
      const [sortFieldInput, sortOrderInput = "desc"] = sort.split(".");
      const sortOrder = sortOrderInput.toLowerCase() === "asc" ? "asc" : "desc";
      const sortColumnMapping: Record<string, string> = {
        created_at: "created_at",
        price: "price",
        title: "title",
        bedrooms: "effective_bedrooms",
        bathrooms: "effective_bathrooms",
        garages: "house_garages",
        parkings: "house_parkings",
        parking_spaces: "effective_parking_spaces",
        size_sqm: "land_size_sqm",
        square_meters: "effective_square_meters",
        status: "status",
      };
      const sortColumn = sortColumnMapping[sortFieldInput] || "created_at";
      regularQuery = regularQuery.order(sortColumn, {
        ascending: sortOrder === "asc",
        nullsFirst: false,
      });
    } catch (e) {
      this.logger.warn(
        `Failed to parse sort parameter: ${sort}. Defaulting to created_at.desc`,
      );
      regularQuery = regularQuery.order("created_at", {
        ascending: false,
        nullsFirst: false,
      });
    }

    regularQuery = regularQuery.range(from, to);
    const {
      data: regularData,
      error: regularError,
      count: totalRegularCount,
    } = await regularQuery;

    if (regularError?.code === "PGRST103") {
      return {
        properties: [],
        total: 0,
        page: Number(page),
        pageSize: Number(pageSize),
      };
    }
    if (regularError) {
      this.logger.error(
        `Error fetching regular properties: ${regularError.message}`,
        regularError.stack,
      );
      throw new InternalServerErrorException(
        `Failed to retrieve properties: ${regularError.message}`,
      );
    }

    const regularProperties: Property[] = (regularData || []).map((p) => ({
      ...this.mapDbRowToProperty(p),
      isInjectedAd: false,
    }));

    const finalPropertiesList: Property[] = [];
    let regularItemCounter = 0;
    let adCycleIndex = (page - 1) * Math.floor(pageSize / REGULAR_PROPERTIES_PER_AD);


    if (promotedAdCandidates.length > 0) {
      for (const regularProp of regularProperties) {
        finalPropertiesList.push(regularProp);
        regularItemCounter++;

        if (regularItemCounter % REGULAR_PROPERTIES_PER_AD === 0) {
          let injectedAdThisRound = false;
          for (let i = 0; i < promotedAdCandidates.length; i++) {
            const potentialAd = promotedAdCandidates[adCycleIndex % promotedAdCandidates.length];
            adCycleIndex++; 
            if (!finalPropertiesList.find(p => p.id === potentialAd.id)) {
              finalPropertiesList.push(potentialAd);
              injectedAdThisRound = true;
              break; 
            }
          }
        }
      }
    } else {
      finalPropertiesList.push(...regularProperties);
    }

    return {
      properties: finalPropertiesList,
      total: totalRegularCount ?? 0,
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
        this.logger.warn("Rolling back Cloudinary uploads due to DB error.");
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
          baseError?.message || "Unknown error"
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
          .eq("id", newBaseProperty.id);
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
      throw new BadRequestException("Property ID cannot be empty");
    }
    this.logger.log(`Finding property with ID: ${id}`);
    const { data, error } = await this.supabase
      .from("properties_view")
      .select("*")
      .eq("id", id)
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
      throw new BadRequestException("Property ID cannot be empty");
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
        if (typeof publicId === "string" && publicId.trim() !== "") {
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

    if (baseUpdatesToApply.hasOwnProperty("use_phone_for_call")) {
      baseUpdatesToApply.use_phone_for_call =
        baseUpdatesToApply.use_phone_for_call ??
        !!baseUpdatesToApply.contact_phone_number;
    }
    if (baseUpdatesToApply.hasOwnProperty("use_whatsapp_for_message")) {
      baseUpdatesToApply.use_whatsapp_for_message =
        baseUpdatesToApply.use_whatsapp_for_message ??
        !!baseUpdatesToApply.contact_whatsapp_number;
    }

    const categoryForDetailUpdate =
      baseUpdatesFromDto.category || currentProperty.category;

    if (Object.keys(baseUpdatesToApply).length > 0) {
      this.logger.log(`Updating base properties for ID: ${id} in Supabase`);
      const { data: updatedBase, error: baseUpdateError } =
        await this.supabase
          .from(this.baseTableName)
          .update(baseUpdatesToApply)
          .eq("id", id)
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
        .upsert({ ...details, property_id: id }, { onConflict: "property_id" });

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
      throw new BadRequestException("Property ID cannot be empty");
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
      .delete({ count: "exact" })
      .eq("id", id);

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
