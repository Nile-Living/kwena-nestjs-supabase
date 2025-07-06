// profiles.controller.ts
import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UseInterceptors,
} from "@nestjs/common";
import { ProfilesService } from "./profiles.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { GetUser } from "src/auth/decoraters/get-user.decorator";
import { User as AuthUser } from "@supabase/supabase-js";
import { IsString, IsIn, Matches } from "class-validator";
import { CacheInterceptor, CacheResponse } from '../cache/cache.interceptor';
import { CacheService } from '../cache/cache.service';

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

@Controller("profiles")
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // ADD THIS NEW GET ENDPOINT
  @Get("me") // Endpoint: GET /api/profiles/me
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(CacheInterceptor)
  @CacheResponse('profiles:user', CacheService.TTL.USER_DATA)
  @HttpCode(HttpStatus.OK)
  async getUserProfile(@GetUser() authUser: AuthUser) {
    if (!authUser || !authUser.id) {
      throw new Error("User not authenticated or ID missing.");
    }
    return this.profilesService.getUserProfile(authUser.id);
  }

  @Patch("me") // Endpoint: PATCH /api/profiles/me
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateUserProfile(
    @GetUser() authUser: AuthUser,
    @Body(ValidationPipe) updateProfileDto: UpdateProfileDto,
  ) {
    if (!authUser || !authUser.id) {
      throw new Error("User not authenticated or ID missing.");
    }
    return this.profilesService.updateUserProfile(
      authUser.id,
      updateProfileDto,
    );
  }
}
