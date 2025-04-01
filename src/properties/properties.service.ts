// src/properties/properties.service.ts
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
  import { UpdatePropertyDto } from "./dto/update-property.dto";
  import { QueryPropertyDto } from "./dto/query-property.dto";
  import {
    PropertyResponseDto,
    Property,
  } from "./dto/property.response.dto";
  
  @Injectable()
  export class PropertiesService {
    private readonly logger = new Logger(PropertiesService.name);
    private readonly tableName = "properties"; // Define table name once
  
    // Inject the Supabase client
    constructor(
      @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    ) {}
  
    async create(
      createPropertyDto: CreatePropertyDto,
    ): Promise<Property> {
      this.logger.log(
        `Creating property: ${JSON.stringify(createPropertyDto)}`,
      );
      const { data, error } = await this.supabase
        .from(this.tableName)
        .insert(createPropertyDto)
        .select() // Select the created record
        .single(); // Expect a single result
  
      if (error) {
        this.logger.error(`Error creating property: ${error.message}`, error);
        // Customize error handling based on Supabase error codes if needed
        throw new InternalServerErrorException(
          `Failed to create property: ${error.message}`,
        );
      }
  
      if (!data) {
        this.logger.error("Property creation returned no data.");
        throw new InternalServerErrorException(
          "Property creation failed unexpectedly.",
        );
      }
  
      this.logger.log(`Property created successfully with ID: ${data.id}`);
      return data as Property; // Cast to the expected return type
    }
  
    async findAll(
      queryDto: QueryPropertyDto,
    ): Promise<PropertyResponseDto> {
      const {
        page = 1,
        pageSize = 10,
        minPrice,
        maxPrice,
        location,
        bedrooms,
        bathrooms, // Added
        garage, // Added
        parkings, // Added
        propertyType,
        sort,
      } = queryDto;
  
      this.logger.log(`Finding all properties with query: ${JSON.stringify(queryDto)}`);
  
      const offset = (page - 1) * pageSize;
  
      let query = this.supabase
        .from(this.tableName)
        .select("*", { count: "exact" }); // Use count: 'exact' to get total
  
      // Apply filters
      if (minPrice !== undefined) {
        query = query.gte("price", minPrice);
      }
      if (maxPrice !== undefined) {
        query = query.lte("price", maxPrice);
      }
      if (location) {
        // Use ilike for case-insensitive partial matching
        query = query.ilike("location", `%${location}%`);
      }
      if (bedrooms !== undefined) {
        query = query.eq("bedrooms", bedrooms);
      }
      if (bathrooms !== undefined) {
        query = query.eq("bathrooms", bathrooms);
      }
      if (garage !== undefined) {
        query = query.eq("garage", garage);
      }
      if (parkings !== undefined) {
        query = query.eq("parkings", parkings);
      }
      if (propertyType) {
        query = query.eq("category", propertyType);
      }
  
      // Apply sorting (example: "price.asc" or "created_at.desc")
      if (sort) {
        const [sortField, sortOrder] = sort.split(".");
        if (sortField && (sortOrder === "asc" || sortOrder === "desc")) {
          query = query.order(sortField, {
            ascending: sortOrder === "asc",
          });
        } else {
          this.logger.warn(`Invalid sort format: ${sort}. Ignoring sort.`);
        }
      } else {
        // Default sort if needed, e.g., by creation date
        query = query.order("created_at", { ascending: false });
      }
  
      // Apply pagination
      query = query.range(offset, offset + pageSize - 1);
  
      const { data, error, count } = await query;
  
      if (error) {
        this.logger.error(
          `Error finding properties: ${error.message}`,
          error,
        );
        throw new InternalServerErrorException(
          `Failed to retrieve properties: ${error.message}`,
        );
      }
  
      this.logger.log(`Found ${data?.length || 0} properties, total count: ${count}`);
  
      return {
        properties: (data as Property[]) || [],
        total: count ?? 0,
        page: page,
        pageSize: pageSize,
      };
    }
  
    // Optional: findOne if needed directly, otherwise update/delete handle checks
    async findOne(id: string): Promise<Property> {
      this.logger.log(`Finding property with ID: ${id}`);
      if (!id) {
        throw new BadRequestException("Property ID cannot be empty");
      }
  
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select("*")
        .eq("id", id)
        .single(); // Expect a single result or null
  
      if (error) {
        // Handle specific errors like PGROST000 (not found) if needed
        this.logger.error(
          `Error finding property ${id}: ${error.message}`,
          error,
        );
        // Don't throw NotFoundException for generic errors
        throw new InternalServerErrorException(
          `Failed to retrieve property: ${error.message}`,
        );
      }
  
      if (!data) {
        this.logger.warn(`Property with ID ${id} not found.`);
        throw new NotFoundException(`Property with ID ${id} not found`);
      }
  
      return data as Property;
    }
  
    async update(
      id: string,
      updatePropertyDto: UpdatePropertyDto,
    ): Promise<Property> {
      this.logger.log(
        `Updating property ${id} with data: ${JSON.stringify(updatePropertyDto)}`,
      );
      if (!id) {
        throw new BadRequestException("Property ID cannot be empty");
      }
      if (Object.keys(updatePropertyDto).length === 0) {
        throw new BadRequestException("Update data cannot be empty.");
      }
  
      const { data, error } = await this.supabase
        .from(this.tableName)
        .update(updatePropertyDto)
        .eq("id", id)
        .select() // Select the updated record
        .single(); // Expect a single result
  
      if (error) {
        this.logger.error(
          `Error updating property ${id}: ${error.message}`,
          error,
        );
        // Check if error indicates not found (e.g., based on Supabase error code or count)
        // Supabase update might not error if the row doesn't exist but returns no data.
        throw new InternalServerErrorException(
          `Failed to update property: ${error.message}`,
        );
      }
  
      // After Supabase v10+, update returns null data if row not found, without erroring.
      if (!data) {
         this.logger.warn(`Property with ID ${id} not found during update.`);
         // Check if it existed before attempting update (optional, adds overhead)
         // const exists = await this.findOne(id).catch(() => null);
         // if (!exists) {
         throw new NotFoundException(`Property with ID ${id} not found`);
         // } else {
         //   throw new InternalServerErrorException("Update failed unexpectedly after finding row.");
         // }
      }
  
  
      this.logger.log(`Property ${id} updated successfully.`);
      return data as Property;
    }
  
    async remove(id: string): Promise<void> {
      this.logger.log(`Removing property with ID: ${id}`);
      if (!id) {
        throw new BadRequestException("Property ID cannot be empty");
      }
  
      const { error, count } = await this.supabase
        .from(this.tableName)
        .delete({ count: 'exact' }) // Get count of deleted rows
        .eq("id", id);
  
      if (error) {
        this.logger.error(
          `Error removing property ${id}: ${error.message}`,
          error,
        );
        throw new InternalServerErrorException(
          `Failed to remove property: ${error.message}`,
        );
      }
  
      // Check if any row was actually deleted
      if (count === 0) {
        this.logger.warn(`Property with ID ${id} not found for deletion.`);
        throw new NotFoundException(`Property with ID ${id} not found`);
      }
  
      this.logger.log(`Property ${id} removed successfully.`);
      // No return value needed for successful deletion (HTTP 204)
    }
  }
  