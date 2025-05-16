import {
    Injectable,
    Inject,
    InternalServerErrorException,
    Logger,
  } from "@nestjs/common";
  import { SupabaseClient } from "@supabase/supabase-js";
  import { SUPABASE_CLIENT } from "../supabase/supabase.constants"; // Adjust path if needed
  import { UpdateProfileDto } from "./profiles.controller"; // Or from a DTO file
  
  @Injectable()
  export class ProfilesService {
    private readonly logger = new Logger(ProfilesService.name);
  
    constructor(
      @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    ) {}
  
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
        .select() // Optionally select to confirm update or get the updated row
        .single(); // If you expect only one row to be updated and want it returned
  
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
      // Ensure your backend Supabase client is initialized with the service role key.
      const { data: adminUserUpdateData, error: adminUserUpdateError } =
        await this.supabase.auth.admin.updateUserById(userId, {
          phone: profileData.phone,
          user_metadata: { role: profileData.role },
        });
  
      if (adminUserUpdateError) {
        this.logger.error(
          `Failed to update auth.users via admin for user ${userId}: ${adminUserUpdateError.message}`,
        );
        // Decide on error handling: throw, or just log warning if profiles table was primary.
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
  }
  