import { Module } from '@nestjs/common';
import { ConfigModule } from "@nestjs/config"
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PropertiesModule } from "./properties/properties.module";
import { SupabaseModule } from "./supabase/supabase.module";


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env"
    }),
    SupabaseModule,
    PropertiesModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
