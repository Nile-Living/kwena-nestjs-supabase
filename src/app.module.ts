import { Module } from '@nestjs/common';
import { ConfigModule } from "@nestjs/config"
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PropertiesModule } from "./properties/properties.module";
import { SupabaseModule } from "./supabase/supabase.module";
import { AuthModule } from './auth/auth.module';
import { SavedPropertiesModule } from './users/saved-properties/saved-properties.module';
import { LencoModule } from './lenco/lenco.module';
import { PromotionsModule } from './promotions/promotions.module';
import { ProfilesModule } from './profiles/profiles.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PaymentsModule } from './payments/payments.module';
import { ZynleModule } from './zynle/zynle.module';
import { CacheModule } from './cache/cache.module';
import { MonitoringModule } from './monitoring/monitoring.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env"
    }),
    CacheModule,
    SupabaseModule,
    AuthModule,
    PropertiesModule,
    SavedPropertiesModule,
    LencoModule,
    PromotionsModule,
    SavedPropertiesModule,
    ProfilesModule,
    CloudinaryModule,
    NotificationsModule,
    SubscriptionsModule,
    PaymentsModule,
    ZynleModule,
    MonitoringModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
