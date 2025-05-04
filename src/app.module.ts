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


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env"
    }),
    SupabaseModule,
    AuthModule,
    PropertiesModule,
    SavedPropertiesModule,
    LencoModule,
    PromotionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
