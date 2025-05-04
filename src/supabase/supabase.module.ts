import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from './supabase.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SUPABASE_CLIENT,
      useFactory: (ConfigService: ConfigService): SupabaseClient => {
        const logger = new Logger('SupabaseModule');
        const supabaseUrl = ConfigService.get<string>('SUPABASE_URL');
        const supabaseKey = ConfigService.get<string>('SUPABASE_ANON_KEY');
        const supabaseServiceKey = ConfigService.get<string>("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseKey || !supabaseServiceKey) {
          logger.error(
            'Supabase URL or Key not found in environment variables.',
          );
          throw new Error(
            'Supabase URL or Key not found in environment variables.',
          );
        }

        logger.log('Creating Supabase client...');
        try {
          const client = createClient(supabaseUrl as string, supabaseServiceKey as string, {});
          logger.log('Supabase client created successfully.');
          return client;
        } catch (error) {
          logger.error('Failed to create Supabase client', error);
          throw error;
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [SUPABASE_CLIENT],
})
export class SupabaseModule {}
