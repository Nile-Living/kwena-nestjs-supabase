import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { CacheModule } from "@nestjs/cache-manager"
import { ProfilesService } from 'src/profiles/profiles.service';

@Module({
  imports: [CloudinaryModule,
    CacheModule.register({
      ttl: 600,
      max: 100,
      isGlobal: true,
    })
  ],
  controllers: [PropertiesController],
  providers: [PropertiesService, ProfilesService]
})
export class PropertiesModule {}
