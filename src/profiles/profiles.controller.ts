import {
    Controller,
    Patch,
    Body,
    UseGuards,
    HttpCode,
    HttpStatus,
    ValidationPipe,
  } from "@nestjs/common";
  import { ProfilesService } from "./profiles.service"; // Your service
  import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"; // Correct path
  import { GetUser } from "src/auth/decoraters/get-user.decorator";
  import { User as AuthUser } from "@supabase/supabase-js"; // Supabase User type
  import { IsString, IsIn, Matches } from "class-validator";
  
  // Define UserRole if not already globally available or imported
  export type UserRoleDto = "user" | "agent";
  
  export class UpdateProfileDto {
    @IsString()
    @Matches(/^\+[1-9]\d{1,14}$/, {
      message: "Phone number must be in E.164 format (e.g., +260...).",
    })
    phone: string;
  
    @IsString()
    @IsIn(["user", "agent"], { message: "Invalid user role selected." })
    role: UserRoleDto;
  }
  
  @Controller("profiles") // Changed from "users" to "profiles" to match your file structure
  export class ProfilesController {
    constructor(private readonly profilesService: ProfilesService) {}
  
    @Patch("me") // Endpoint: PATCH /api/profiles/me
    @UseGuards(JwtAuthGuard) // Apply the guard
    @HttpCode(HttpStatus.OK)
    async updateUserProfile(
      @GetUser() authUser: AuthUser, // Use the decorator
      @Body(ValidationPipe) updateProfileDto: UpdateProfileDto,
    ) {
      if (!authUser || !authUser.id) {
        // This case should be handled by JwtAuthGuard, but as a defensive check
        throw new Error("User not authenticated or ID missing.");
      }
      return this.profilesService.updateUserProfile(
        authUser.id,
        updateProfileDto,
      );
    }
  }
  