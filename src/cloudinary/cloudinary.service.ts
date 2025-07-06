import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as streamifier from 'streamifier'

@Injectable()
export class CloudinaryService {
  async uploadImage(
    file: Express.Multer.File,
    folder: string = 'properties',
  ): Promise<UploadApiResponse> {
    return new Promise<UploadApiResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: folder },
        (error, result) => {
          if (error) return reject(new InternalServerErrorException(error.message));
          if (!result) return reject(new InternalServerErrorException('Cloudinary upload failed to return a result.'));
          resolve(result);
        },
      );
      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  async deleteImage(publicId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(publicId, (error, result) => {
        if (error) return reject(new InternalServerErrorException(error.message));
        resolve(result);
      });
    });
  }

  getPublicIdFromUrl(imageUrl: string): string | null {
    const regex = /\/upload\/(?:v\d+\/)?([^\.]+)/;
    const match = imageUrl.match(regex);
    return match ? match[1] : null;
  }
}
