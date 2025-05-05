// src/properties/properties.controller.ts
import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Delete,
    Put,
    Query,
    HttpCode,
    HttpStatus,
    ParseUUIDPipe, // Use if your IDs are UUIDs
  } from "@nestjs/common";
  import { PropertiesService } from "./properties.service";
  import { CreatePropertyDto } from "./dto/create-property.dto";
  import { UpdatePropertyDto } from "./dto/update-property.dto";
  import { QueryPropertyDto } from "./dto/query-property.dto";
  import {
    PropertyResponseDto,
    Property,
  } from "./dto/property.response.dto";
  
  @Controller("properties") // Base path /api/properties (due to global prefix)
  export class PropertiesController {
    constructor(private readonly propertiesService: PropertiesService) {}
  
    @Post()
    @HttpCode(HttpStatus.CREATED)
    create(@Body() createPropertyDto: CreatePropertyDto): Promise<Property> {
      return this.propertiesService.create(createPropertyDto);
    }
  
    @Get()
    @HttpCode(HttpStatus.OK)
    findAll(
      @Query() queryDto: QueryPropertyDto,
    ): Promise<PropertyResponseDto> {
      return this.propertiesService.findAll(queryDto);
    }
  
    @Get(":id")
    @HttpCode(HttpStatus.OK)
    findOne(
      @Param("id" /*, ParseUUIDPipe */) id: string
    ): Promise<Property> {
      return this.propertiesService.findOne(id);
    }
  
    @Put(":id") // Use PUT for full resource update semantics
    @HttpCode(HttpStatus.OK)
    update(
      @Param("id" /*, ParseUUIDPipe */) id: string,
      @Body() updatePropertyDto: UpdatePropertyDto,
    ): Promise<Property> {
      return this.propertiesService.update(id, updatePropertyDto);
    }
  
    @Delete(":id")
    @HttpCode(HttpStatus.NO_CONTENT) // Standard for successful DELETE
    remove(@Param("id" /*, ParseUUIDPipe */) id: string): Promise<void> {
      return this.propertiesService.remove(id);
    }

    @Get('promoted')
    @HttpCode(HttpStatus.OK)
    findPromoted(): Promise<Property[]> {
      return this.propertiesService.findPromoted();
    }
  }
  