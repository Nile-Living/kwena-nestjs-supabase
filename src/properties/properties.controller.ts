// src/properties/properties.controller.ts
import {
  Controller,
  Post,
  Body,
  UploadedFiles, // We'll still try to use it, but have a fallback
  HttpCode,
  HttpStatus,
  Logger,
  // Other imports...
  Get, Param, Put, Query, Delete
} from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { QueryPropertyDto } from './dto/query-property.dto';
import { PropertyResponseDto, Property } from './dto/property.response.dto';
import { MultipartFile } from '@fastify/multipart'; // Still useful for type hints

@Controller('properties')
export class PropertiesController {
  private readonly logger = new Logger(PropertiesController.name);

  constructor(private readonly propertiesService: PropertiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createPropertyDto: CreatePropertyDto & { images?: Buffer | Buffer[] }, // Allow 'images' on DTO for what Fastify might add
    @UploadedFiles() uploadedFileParts?: MultipartFile[] | MultipartFile,
  ): Promise<Property> {

    this.logger.debug(
      'Raw DTO from @Body() (potentially unvalidated):',
      JSON.stringify(createPropertyDto, null, 2), // This will show if 'images' (Buffer) is present
    );

    const filesFromUploadedPartsArray: MultipartFile[] = uploadedFileParts
      ? Array.isArray(uploadedFileParts)
        ? uploadedFileParts
        : [uploadedFileParts]
      : [];

    this.logger.debug(
        'Data from @UploadedFiles() (after normalization):',
        filesFromUploadedPartsArray.map(f => ({ filename: f.filename, fieldname: f.fieldname, type: typeof f.toBuffer }))
    );


    // Manual JSON parsing for details and coordinates
    if (createPropertyDto.details && typeof createPropertyDto.details === 'string') {
      try { createPropertyDto.details = JSON.parse(createPropertyDto.details as string); }
      catch (e) { this.logger.error('Failed to parse details from string', e); }
    }
    if (createPropertyDto.coordinates && typeof createPropertyDto.coordinates === 'string') {
      try { createPropertyDto.coordinates = JSON.parse(createPropertyDto.coordinates as string); }
      catch (e) { this.logger.error('Failed to parse coordinates from string', e); }
    }

    let adaptedFiles: Express.Multer.File[] = [];

    // Prioritize files from @UploadedFiles if they are valid and have toBuffer
    if (filesFromUploadedPartsArray.length > 0 && typeof filesFromUploadedPartsArray[0]?.toBuffer === 'function') {
      this.logger.debug('Attempting to adapt files from @UploadedFiles() using .toBuffer()');
      adaptedFiles = await Promise.all(
        filesFromUploadedPartsArray.map(async (filePart) => {
          const buffer = await filePart.toBuffer();
          return {
            fieldname: filePart.fieldname,
            originalname: filePart.filename,
            encoding: filePart.encoding,
            mimetype: filePart.mimetype,
            buffer: buffer,
            size: buffer.length,
            stream: (filePart as any).file, // May not be reliable
            destination: '',
            filename: filePart.filename,
            path: '',
          } as Express.Multer.File;
        }),
      );
    }
    // Fallback: If @UploadedFiles didn't work, check if the buffer is on the DTO
    // This assumes a single file upload named 'images' by the client
    else if (createPropertyDto.images && Buffer.isBuffer(createPropertyDto.images)) {
      this.logger.debug('Using image Buffer found directly on CreatePropertyDto');
      adaptedFiles = [{
        fieldname: 'images', // Assuming the field name from FormData
        originalname: 'uploaded_image_from_body.bin', // Placeholder
        encoding: '', // Unknown
        mimetype: 'application/octet-stream', // Unknown, try to get from DTO if possible
        buffer: createPropertyDto.images,
        size: createPropertyDto.images.length,
        stream: null as any,
        destination: '',
        filename: 'uploaded_image_from_body.bin',
        path: '',
      } as Express.Multer.File];
    } else if (createPropertyDto.images && Array.isArray(createPropertyDto.images) && createPropertyDto.images.every(img => Buffer.isBuffer(img))) {
        this.logger.debug('Using array of image Buffers found directly on CreatePropertyDto');
        adaptedFiles = createPropertyDto.images.map((buffer, index) => ({
            fieldname: 'images', // Assuming the field name from FormData
            originalname: `uploaded_image_${index}_from_body.bin`, // Placeholder
            encoding: '',
            mimetype: 'application/octet-stream',
            buffer: buffer,
            size: buffer.length,
            stream: null as any,
            destination: '',
            filename: `uploaded_image_${index}_from_body.bin`,
            path: '',
        } as Express.Multer.File));
    } else {
        this.logger.warn('No valid files found from @UploadedFiles() or on DTO.images');
    }

    // Remove the 'images' (Buffer) property from createPropertyDto before passing to service,
    // as the service expects 'images' to be Cloudinary URLs it will generate.
    const { images: dtoImageBuffer, ...dtoWithoutImageBuffer } = createPropertyDto;

    return this.propertiesService.create(dtoWithoutImageBuffer, adaptedFiles);
  }

  // Similar logic would be needed for the update method if it also handles file uploads
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updatePropertyDto: UpdatePropertyDto & { newImages?: Buffer | Buffer[] },
    @UploadedFiles() uploadedFileParts?: MultipartFile[] | MultipartFile,
  ): Promise<Property> {

    this.logger.debug('Raw DTO from @Body() for UPDATE:', JSON.stringify(updatePropertyDto, null, 2));

    const newImagesArrayFromUploaded: MultipartFile[] = uploadedFileParts
      ? Array.isArray(uploadedFileParts) ? uploadedFileParts : [uploadedFileParts]
      : [];
    this.logger.debug('Update: Received newImages from @UploadedFiles (after normalization):', newImagesArrayFromUploaded.length);
    this.logger.debug(
        'Update: Data from @UploadedFiles():',
        newImagesArrayFromUploaded.map(f => ({ filename: f.filename, fieldname: f.fieldname, type: typeof f.toBuffer }))
    );


    if (updatePropertyDto.existingImageUrls && typeof updatePropertyDto.existingImageUrls === 'string') { /* ... */ }
    if (updatePropertyDto.deletedImagePublicIds && typeof updatePropertyDto.deletedImagePublicIds === 'string') { /* ... */ }
    if (updatePropertyDto.details && typeof updatePropertyDto.details === 'string') { /* ... */ }
    if (updatePropertyDto.coordinates && typeof updatePropertyDto.coordinates === 'string') { /* ... */ }

    let adaptedNewImages: Express.Multer.File[] = [];

    if (newImagesArrayFromUploaded.length > 0 && typeof newImagesArrayFromUploaded[0]?.toBuffer === 'function') {
        this.logger.debug('Update: Attempting to adapt files from @UploadedFiles() using .toBuffer()');
        adaptedNewImages = await Promise.all(
            newImagesArrayFromUploaded.map(async (filePart) => {
                const buffer = await filePart.toBuffer();
                return { /* ... as in create ... */ } as Express.Multer.File;
            })
        );
    } else if (updatePropertyDto.newImages && Buffer.isBuffer(updatePropertyDto.newImages)) {
        this.logger.debug('Update: Using newImage Buffer found directly on UpdatePropertyDto');
        adaptedNewImages = [{ /* ... as in create, using updatePropertyDto.newImages ... */ } as Express.Multer.File];
    } else if (updatePropertyDto.newImages && Array.isArray(updatePropertyDto.newImages) && updatePropertyDto.newImages.every(img => Buffer.isBuffer(img))) {
        this.logger.debug('Update: Using array of newImage Buffers found directly on UpdatePropertyDto');
        adaptedNewImages = updatePropertyDto.newImages.map((buffer, index) => ({ /* ... as in create ... */ } as Express.Multer.File));
    } else {
        this.logger.warn('Update: No valid new files found from @UploadedFiles() or on DTO.newImages');
    }

    const { newImages: dtoNewImageBuffer, ...dtoWithoutNewImageBuffer } = updatePropertyDto;

    return this.propertiesService.update(id, dtoWithoutNewImageBuffer, adaptedNewImages);
  }


  // ... (findAll, findPromoted, findOne, remove methods remain the same) ...
  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(@Query() queryDto: QueryPropertyDto): Promise<PropertyResponseDto> {
    return this.propertiesService.findAll(queryDto);
  }

  @Get('promoted')
  @HttpCode(HttpStatus.OK)
  findPromoted(): Promise<Property[]> {
    return this.propertiesService.findPromoted();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id') id: string): Promise<Property> {
    return this.propertiesService.findOne(id);
  }
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.propertiesService.remove(id);
  }
}
