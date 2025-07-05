import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { CacheModule } from 'src/cache/cache.module';
import { ProfilesService } from 'src/profiles/profiles.service';

@Module({
  imports: [CloudinaryModule, CacheModule],
  controllers: [PropertiesController],
  providers: [PropertiesService, ProfilesService]
})
export class PropertiesModule {}
