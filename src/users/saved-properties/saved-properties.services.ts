import {
  Injectable,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from 'src/supabase/supabase.constants';

@Injectable()
export class SavedPropertiesService {
  private readonly logger = new Logger(SavedPropertiesService.name);
  private readonly tableName = 'saved_properties';

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async findSavedPropertyIds(userId: string): Promise<string[]> {
    this.logger.log(`Fetching saved property IDs for user: ${userId}`);
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('property_id')
        .eq('user_id', userId);

      if (error) {
        this.logger.error(
          `Error fetching saved properties for user ${userId}: ${error.message}`,
          error.stack,
        );
        throw error;
      }
      const propertyIds = (data || []).map((item) => item.property_id);
      this.logger.log(
        `Found ${propertyIds.length} saved properties for user: ${userId}`,
      );
      return propertyIds;
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to retrieve saved properties: ${error.message}`,
      );
    }
  }

  async addSavedProperty(userId: string, propertyId: string): Promise<void> {
    this.logger.log(
      `Attempting to save property ${propertyId} for user: ${userId}`,
    );

    try {
      const { error } = await this.supabase.from(this.tableName).insert({
        user_id: userId,
        property_id: propertyId,
      });

      if (error) {
        if (error.code === '23505') {
          this.logger.warn(
            `Property ${propertyId} already saved for user ${userId}. Ignoring duplicate request.`,
          );
          return;
        } else {
          this.logger.error(
            `Error saving property ${propertyId} for user ${userId}: ${error.message}`,
            error.stack,
          );
          throw error;
        }
      }
      this.logger.log(
        `Successfully saved property ${propertyId} for user: ${userId}`,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to save property: ${error.message}`,
      );
    }
  }

  async removeSavedProperty(userId: string, propertyId: string): Promise<void> {
    this.logger.log(
      `Attempting to remove saved property ${propertyId} for user: ${userId}`,
    );
    try {
      const { error, count } = await this.supabase
        .from(this.tableName)
        .delete({ count: 'exact' })
        .match({
          user_id: userId,
          property_id: propertyId,
        });

      if (error) {
        this.logger.error(
          `Error removing saved property ${propertyId} for user ${userId}: ${error.message}`,
          error.stack,
        );
        throw error;
      }
      if (count === 0) {
        this.logger.warn(
          `Saved property ${propertyId} not found for user ${userId} during removal, or already removed.`,
        );
        
      } else {
        this.logger.log(
          `Successfully removed saved property ${propertyId} for user: ${userId}`,
        );
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw new InternalServerErrorException(
          `Failed to remove saved property: ${error.message}`,
        );
      } else {
        throw error;
      }
    }
  }
}
