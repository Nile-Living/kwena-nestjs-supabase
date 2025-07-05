import {
  Controller,
  Post,
  Body,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  Logger,
  Get, Param, Put, Query, Delete, UseInterceptors, UseGuards
} from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { QueryPropertyDto } from './dto/query-property.dto';
import { PropertyResponseDto, Property } from './dto/property.response.dto';
import { MultipartFile } from '@fastify/multipart';
import { FilesInterceptor } from '@nestjs/platform-express'; // Or Fastify equivalent if you set one up
import { AuthGuard } from '@nestjs/passport';
import { CacheInterceptor, CacheResponse } from '../cache/cache.interceptor';
import { CacheService } from '../cache/cache.service';


@Controller('properties')
export class PropertiesController {
  private readonly logger = new Logger(PropertiesController.name);

  constructor(private readonly propertiesService: PropertiesService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createPropertyDto: CreatePropertyDto & { images?: Buffer | Buffer[] },
    @UploadedFiles() uploadedFileParts?: MultipartFile[] | MultipartFile,
  ): Promise<Property> {

    this.logger.debug('Raw DTO from @Body() (create):', JSON.stringify(createPropertyDto, null, 2));

    const filesFromUploadedPartsArray: MultipartFile[] = uploadedFileParts
      ? Array.isArray(uploadedFileParts) ? uploadedFileParts : [uploadedFileParts]
      : [];

    this.logger.debug('Data from @UploadedFiles() (create):', filesFromUploadedPartsArray.map(f => ({ filename: f.filename, fieldname: f.fieldname })));

    if (createPropertyDto.details && typeof createPropertyDto.details === 'string') {
      try { createPropertyDto.details = JSON.parse(createPropertyDto.details as string); }
      catch (e) { this.logger.error('Failed to parse details from string', e); }
    }
    if (createPropertyDto.coordinates && typeof createPropertyDto.coordinates === 'string') {
      try { createPropertyDto.coordinates = JSON.parse(createPropertyDto.coordinates as string); }
      catch (e) { this.logger.error('Failed to parse coordinates from string', e); }
    }
     if (createPropertyDto.use_phone_for_call && typeof createPropertyDto.use_phone_for_call === 'string') {
      createPropertyDto.use_phone_for_call = createPropertyDto.use_phone_for_call === 'true';
    }
    if (createPropertyDto.use_whatsapp_for_message && typeof createPropertyDto.use_whatsapp_for_message === 'string') {
      createPropertyDto.use_whatsapp_for_message = createPropertyDto.use_whatsapp_for_message === 'true';
    }


    let adaptedFiles: Express.Multer.File[] = [];

    if (filesFromUploadedPartsArray.length > 0 && typeof filesFromUploadedPartsArray[0]?.toBuffer === 'function') {
      adaptedFiles = await Promise.all(
        filesFromUploadedPartsArray.map(async (filePart) => {
          const buffer = await filePart.toBuffer();
          return {
            fieldname: filePart.fieldname, originalname: filePart.filename, encoding: filePart.encoding,
            mimetype: filePart.mimetype, buffer: buffer, size: buffer.length,
            stream: (filePart as any).file, destination: '', filename: filePart.filename, path: '',
          } as Express.Multer.File;
        }),
      );
    }
    else if (createPropertyDto.images && Buffer.isBuffer(createPropertyDto.images)) {
      adaptedFiles = [{
        fieldname: 'images', originalname: 'uploaded_image_from_body.bin', encoding: '',
        mimetype: 'application/octet-stream', buffer: createPropertyDto.images, size: createPropertyDto.images.length,
        stream: null as any, destination: '', filename: 'uploaded_image_from_body.bin', path: '',
      } as Express.Multer.File];
    } else if (createPropertyDto.images && Array.isArray(createPropertyDto.images) && createPropertyDto.images.every(img => Buffer.isBuffer(img))) {
        adaptedFiles = createPropertyDto.images.map((buffer, index) => ({
            fieldname: 'images', originalname: `uploaded_image_${index}_from_body.bin`, encoding: '',
            mimetype: 'application/octet-stream', buffer: buffer, size: buffer.length,
            stream: null as any, destination: '', filename: `uploaded_image_${index}_from_body.bin`, path: '',
        } as Express.Multer.File));
    } else {
        this.logger.warn('No valid files found from @UploadedFiles() or on DTO.images (create)');
    }
    const { images: dtoImageBuffer, ...dtoWithoutImageBuffer } = createPropertyDto;
    return this.propertiesService.create(dtoWithoutImageBuffer, adaptedFiles);
  }

  @Put(':id')
  @UseGuards(AuthGuard('jwt'))
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

    if (updatePropertyDto.existingImageUrls && typeof updatePropertyDto.existingImageUrls === 'string') {
        try { updatePropertyDto.existingImageUrls = JSON.parse(updatePropertyDto.existingImageUrls); } catch(e) {this.logger.error('Failed to parse existingImageUrls');}
    }
    if (updatePropertyDto.deletedImagePublicIds && typeof updatePropertyDto.deletedImagePublicIds === 'string') {
        try { updatePropertyDto.deletedImagePublicIds = JSON.parse(updatePropertyDto.deletedImagePublicIds); } catch(e) {this.logger.error('Failed to parse deletedImagePublicIds');}
    }
    if (updatePropertyDto.details && typeof updatePropertyDto.details === 'string') {
      try { updatePropertyDto.details = JSON.parse(updatePropertyDto.details as string); }
      catch (e) { this.logger.error('Failed to parse details from string (update)', e); }
    }
    if (updatePropertyDto.coordinates && typeof updatePropertyDto.coordinates === 'string') {
      try { updatePropertyDto.coordinates = JSON.parse(updatePropertyDto.coordinates as string); }
      catch (e) { this.logger.error('Failed to parse coordinates from string (update)', e); }
    }
    if (updatePropertyDto.use_phone_for_call && typeof updatePropertyDto.use_phone_for_call === 'string') {
      updatePropertyDto.use_phone_for_call = updatePropertyDto.use_phone_for_call === 'true';
    }
    if (updatePropertyDto.use_whatsapp_for_message && typeof updatePropertyDto.use_whatsapp_for_message === 'string') {
      updatePropertyDto.use_whatsapp_for_message = updatePropertyDto.use_whatsapp_for_message === 'true';
    }


    let adaptedNewImages: Express.Multer.File[] = [];

    if (newImagesArrayFromUploaded.length > 0 && typeof newImagesArrayFromUploaded[0]?.toBuffer === 'function') {
        adaptedNewImages = await Promise.all(
            newImagesArrayFromUploaded.map(async (filePart) => {
                const buffer = await filePart.toBuffer();
                return {
                    fieldname: filePart.fieldname, originalname: filePart.filename, encoding: filePart.encoding,
                    mimetype: filePart.mimetype, buffer: buffer, size: buffer.length,
                    stream: (filePart as any).file, destination: '', filename: filePart.filename, path: '',
                } as Express.Multer.File;
            })
        );
    } else if (updatePropertyDto.newImages && Buffer.isBuffer(updatePropertyDto.newImages)) {
        adaptedNewImages = [{
            fieldname: 'newImages', originalname: 'new_uploaded_image_from_body.bin', encoding: '',
            mimetype: 'application/octet-stream', buffer: updatePropertyDto.newImages, size: updatePropertyDto.newImages.length,
            stream: null as any, destination: '', filename: 'new_uploaded_image_from_body.bin', path: '',
        } as Express.Multer.File];
    } else if (updatePropertyDto.newImages && Array.isArray(updatePropertyDto.newImages) && updatePropertyDto.newImages.every(img => Buffer.isBuffer(img))) {
        adaptedNewImages = updatePropertyDto.newImages.map((buffer, index) => ({
            fieldname: 'newImages', originalname: `new_uploaded_image_${index}_from_body.bin`, encoding: '',
            mimetype: 'application/octet-stream', buffer: buffer, size: buffer.length,
            stream: null as any, destination: '', filename: `new_uploaded_image_${index}_from_body.bin`, path: '',
        } as Express.Multer.File));
    } else {
        this.logger.warn('Update: No valid new files found from @UploadedFiles() or on DTO.newImages');
    }

    const { newImages: dtoNewImageBuffer, ...dtoWithoutNewImageBuffer } = updatePropertyDto;
    return this.propertiesService.update(id, dtoWithoutNewImageBuffer, adaptedNewImages);
  }

  @Get()
  @UseInterceptors(CacheInterceptor)
  @CacheResponse('properties:list', CacheService.TTL.PROPERTIES_LIST)
  @HttpCode(HttpStatus.OK)
  findAll(@Query() queryDto: QueryPropertyDto): Promise<PropertyResponseDto> {
    return this.propertiesService.findAll(queryDto);
  }

  @Get('promoted')
  @UseInterceptors(CacheInterceptor)
  @CacheResponse('properties:promoted', CacheService.TTL.PROPERTIES_LIST)
  @HttpCode(HttpStatus.OK)
  findPromoted(): Promise<Property[]> {
    return this.propertiesService.findPromoted();
  }

  @Get(':id')
  @UseInterceptors(CacheInterceptor)
  @CacheResponse('properties:detail', CacheService.TTL.PROPERTY_DETAIL)
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id') id: string): Promise<Property> {
    return this.propertiesService.findOne(id);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.propertiesService.remove(id);
  }
}
