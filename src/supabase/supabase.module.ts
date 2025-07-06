// supabase.module.ts
import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  SUPABASE_ANON_CLIENT,
  SUPABASE_SERVICE_ADMIN,
} from './supabase.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    // 1) The “anon” key client (honors RLS)
    {
      provide: SUPABASE_ANON_CLIENT,
      useFactory: (config: ConfigService): SupabaseClient => {
        const url = config.get<string>('SUPABASE_URL')!;
        const anon = config.get<string>('SUPABASE_ANON_KEY')!;
        if (!url || !anon) {
          throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
        }
        return createClient(url, anon);
      },
      inject: [ConfigService],
    },

    // 2) The “service‐role” client (bypasses RLS)
    {
      provide: SUPABASE_SERVICE_ADMIN,
      useFactory: (config: ConfigService): SupabaseClient => {
        const url   = config.get<string>('SUPABASE_URL')!;
        const admin = config.get<string>('SUPABASE_SERVICE_ROLE_KEY')!;
        if (!url || !admin) {
          throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        }
        return createClient(url, admin);
      },
      inject: [ConfigService],
    },
  ],
  exports: [SUPABASE_ANON_CLIENT, SUPABASE_SERVICE_ADMIN],
})
export class SupabaseModule {}