import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export interface IdempotencyResult<T> {
  isNewRequest: boolean;
  data?: T;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly supabase: SupabaseClient) {}

  async processWithIdempotency<T>(
    key: string,
    resourceType: string,
    operation: () => Promise<T>
  ): Promise<IdempotencyResult<T>> {
    // Check if we've already processed this request
    const { data: existing, error: fetchError } = await this.supabase
      .from('idempotency_keys')
      .select('response_data, resource_id')
      .eq('key', key)
      .eq('resource_type', resourceType)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (fetchError) {
      this.logger.error(`Error checking idempotency: ${fetchError.message}`);
      throw new Error('Idempotency check failed');
    }

    // Return cached result if exists
    if (existing) {
      this.logger.log(`Returning cached result for idempotency key: ${key}`);
      return {
        isNewRequest: false,
        data: existing.response_data as T
      };
    }

    // Process new request
    const result = await operation();

    // Store result for future requests
    const { error: insertError } = await this.supabase
      .from('idempotency_keys')
      .insert({
        key,
        resource_type: resourceType,
        resource_id: this.extractResourceId(result),
        response_data: result,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });

    if (insertError) {
      this.logger.error(`Error storing idempotency result: ${insertError.message}`);
      // Don't throw here - operation succeeded, just logging failed
    }

    return {
      isNewRequest: true,
      data: result
    };
  }

  private extractResourceId(result: any): string {
    if (result && typeof result === 'object') {
      return result.id || result.reference || JSON.stringify(result).substring(0, 255);
    }
    return String(result).substring(0, 255);
  }
}