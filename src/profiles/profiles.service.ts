// profiles.service.ts
import {
  Injectable,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_CLIENT } from "../supabase/supabase.constants";
import { UpdateProfileDto } from "./profiles.controller";

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    @Inject(SUPABASE_ANON_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  // ADD THIS NEW METHOD
  async getUserProfile(userId: string) {
    this.logger.log(`Fetching profile for user ${userId}`);

    const { data: profile, error } = await this.supabase
      .from("profiles")
      .select("id, full_name, avatar_url, phone, email, role, created_at, updated_at")
      .eq("id", userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        this.logger.warn(`Profile not found for user ${userId}`);
        throw new NotFoundException(`Profile not found for user ${userId}`);
      }
      this.logger.error(
        `Failed to fetch profile for user ${userId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `Could not fetch profile: ${error.message}`,
      );
    }

    this.logger.log(`Profile fetched successfully for user ${userId}`);
    return profile;
  }

  async updateUserProfile(
    userId: string,
    profileData: UpdateProfileDto,
  ): Promise<{ message: string }> {
    this.logger.log(
      `Attempting to update profile for user ${userId} with data: ${JSON.stringify(
        profileData,
      )}`,
    );

    // 1. Update the public.profiles table
    const { error: profileUpdateError } = await this.supabase
      .from("profiles")
      .update({
        phone: profileData.phone,
        role: profileData.role,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select()
      .single();

    if (profileUpdateError) {
      this.logger.error(
        `Failed to update profiles table for user ${userId}: ${profileUpdateError.message}`,
      );
      throw new InternalServerErrorException(
        `Could not update profile details: ${profileUpdateError.message}`,
      );
    }
    this.logger.log(`Profiles table updated for user ${userId}.`);

    // 2. Update auth.users (phone and user_metadata.role) using Admin client
    const { data: adminUserUpdateData, error: adminUserUpdateError } =
      await this.supabase.auth.admin.updateUserById(userId, {
        phone: profileData.phone,
        user_metadata: { role: profileData.role },
      });

    if (adminUserUpdateError) {
      this.logger.error(
        `Failed to update auth.users via admin for user ${userId}: ${adminUserUpdateError.message}`,
      );
      console.warn(
        `Profile table updated, but auth.users update failed for ${userId}: ${adminUserUpdateError.message}`,
      );
    } else {
      this.logger.log(
        `auth.users phone and metadata.role updated for user ${userId}.`,
      );
    }

    return { message: "Profile updated successfully." };
  }

  async getUserProfileById(userId: string) {
    this.logger.log(`Fetching profile for user ${userId}`);

    const { data: profile, error} = await this.supabase
    .from("profiles")
    .select("id, full_name, avatar_url, phone, email, role, created_at")
    .eq("id", userId)
    .single();

    if (error) {
      if (error.code === 'PGRST116') {
        this.logger.warn(`Profile  not found for user ${userId}`);
        return null;
      }
      this.logger.error(
        `Failed to fetch profile for user ${userId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `Could not fetch profile: ${error.message}`,
      );
    }

    this.logger.log(`Profile fetched successfully for user ${userId}`);
    return profile;
  }
}
