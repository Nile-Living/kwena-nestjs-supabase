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
  UseInterceptors,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  Logger, // Added for logging
} from "@nestjs/common";
import { FilesInterceptor } from '@nestjs/platform-express';
import { PropertiesService } from "./properties.service";
import { CreatePropertyDto } from "./dto/create-property.dto";
import { UpdatePropertyDto } from "./dto/update-property.dto";
import { QueryPropertyDto } from "./dto/query-property.dto";
import {
  PropertyResponseDto,
  Property,
} from "./dto/property.response.dto"; // Ensure this matches your actual DTO file

@Controller("properties")
export class PropertiesController {
  private readonly logger = new Logger(PropertiesController.name); // Added for logging

  constructor(private readonly propertiesService: PropertiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('images', 5))
  create(
    @Body() createPropertyDto: CreatePropertyDto,
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          // new MaxFileSizeValidator({ maxSize: 1024 * 1024 * 5 }), // 5MB
          // new FileTypeValidator({ fileType: '.(png|jpeg|jpg|webp)' }),
        ],
        fileIsRequired: false,
      }),
    )
    files?: Array<Express.Multer.File>,
  ): Promise<Property> {
    if (createPropertyDto.details && typeof createPropertyDto.details === 'string') {
        try {
            createPropertyDto.details = JSON.parse(createPropertyDto.details as string);
        } catch (e) {
            this.logger.error('Failed to parse details from string', e);
        }
    }
    if (createPropertyDto.coordinates && typeof createPropertyDto.coordinates === 'string') {
        try {
            createPropertyDto.coordinates = JSON.parse(createPropertyDto.coordinates as string);
        } catch (e) {
            this.logger.error('Failed to parse coordinates from string', e);
        }
    }
    return this.propertiesService.create(createPropertyDto, files);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(
    @Query() queryDto: QueryPropertyDto,
  ): Promise<PropertyResponseDto> {
    return this.propertiesService.findAll(queryDto);
  }

  @Get('promoted')
  @HttpCode(HttpStatus.OK)
  findPromoted(): Promise<Property[]> {
    return this.propertiesService.findPromoted();
  }

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  findOne(
    @Param("id") id: string
  ): Promise<Property> {
    return this.propertiesService.findOne(id);
  }

  @Put(":id")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('newImages', 5))
  update(
    @Param("id") id: string,
    @Body() updatePropertyDto: UpdatePropertyDto,
    @UploadedFiles(
        new ParseFilePipe({
            validators: [
            //   new MaxFileSizeValidator({ maxSize: 1024 * 1024 * 5 }), // 5MB
            //   new FileTypeValidator({ fileType: '.(png|jpeg|jpg|webp)' }),
            ],
            fileIsRequired: false,
          }),
    ) newImages?: Array<Express.Multer.File>,
  ): Promise<Property> {
    if (updatePropertyDto.existingImageUrls && typeof updatePropertyDto.existingImageUrls === 'string') {
        try {
            updatePropertyDto.existingImageUrls = JSON.parse(updatePropertyDto.existingImageUrls as string);
        } catch (e) {
            this.logger.error("Failed to parse existingImageUrls", e);
            updatePropertyDto.existingImageUrls = [];
        }
    }
    if (updatePropertyDto.deletedImagePublicIds && typeof updatePropertyDto.deletedImagePublicIds === 'string') {
        try {
            updatePropertyDto.deletedImagePublicIds = JSON.parse(updatePropertyDto.deletedImagePublicIds as string);
        } catch (e) {
            this.logger.error("Failed to parse deletedImagePublicIds", e);
            updatePropertyDto.deletedImagePublicIds = [];
        }
    }
    if (updatePropertyDto.details && typeof updatePropertyDto.details === 'string') {
        try {
            updatePropertyDto.details = JSON.parse(updatePropertyDto.details as string);
        } catch (e) {
            this.logger.error('Failed to parse details from string for update', e);
        }
    }
    if (updatePropertyDto.coordinates && typeof updatePropertyDto.coordinates === 'string') {
        try {
            updatePropertyDto.coordinates = JSON.parse(updatePropertyDto.coordinates as string);
        } catch (e) {
            this.logger.error('Failed to parse coordinates from string for update', e);
        }
    }
    return this.propertiesService.update(id, updatePropertyDto, newImages);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string): Promise<void> {
    return this.propertiesService.remove(id);
  }
}
