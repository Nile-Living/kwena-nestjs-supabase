// src/saved-properties/saved-properties.controller.ts
import {
    Controller, Get, Post, Delete, Param, Body, UseGuards, Req, HttpCode, HttpStatus, ParseUUIDPipe,
    InternalServerErrorException
  } from '@nestjs/common';
  import { SavedPropertiesService } from './saved-properties.services';
  import { AuthGuard } from '@nestjs/passport'; // Assuming JWT strategy is named 'jwt'
  import { SavePropertyDto } from './dto/save-property.dto';
  import { Property } from 'src/properties/dto/property.response.dto';

  interface AuthenticatedUser {
    id: string;
  }
  
  interface RequestWithUser extends Request { // Use 'Request' from @nestjs/common
    user: AuthenticatedUser;
  }
  
  
  @Controller('users/me/saved-properties') // Route prefix: /api/users/me/saved-properties
  @UseGuards(AuthGuard('jwt')) // Apply authentication guard
  export class SavedPropertiesController {
    constructor(private readonly savedPropertiesService: SavedPropertiesService) {}
  
    @Get()
    @HttpCode(HttpStatus.OK)
    async getSavedProperties(@Req() req: RequestWithUser) {
      // Ensure your AuthGuard/Strategy correctly attaches 'user' with 'id'
      if (!req.user || !req.user.id) {
          throw new InternalServerErrorException('User information not found on request.');
      }
      const userId = req.user.id;
      const savedIds = await this.savedPropertiesService.findSavedPropertyIds(userId);
      // Return in the format expected by the frontend store
      return { savedPropertyIds: savedIds };
    }

    @Get('details') // Handles GET /api/users/me/saved-properties/details
    @HttpCode(HttpStatus.OK)
    async getSavedPropertiesWithDetails(@Req() req: RequestWithUser): Promise<Property[]> {
       if (!req.user || !req.user.id) {
          throw new InternalServerErrorException('User information not found on request.');
      }
      const userId = req.user.id;
      return this.savedPropertiesService.findSavedPropertyDetails(userId);
    }
  
    @Post()
    @HttpCode(HttpStatus.CREATED)
    async saveProperty(@Req() req: RequestWithUser, @Body() body: SavePropertyDto) {
       if (!req.user || !req.user.id) {
          throw new InternalServerErrorException('User information not found on request.');
      }
      const userId = req.user.id;
      // The service handles potential duplicates gracefully
      await this.savedPropertiesService.addSavedProperty(userId, body.propertyId);
      return { message: 'Property saved successfully' }; // Simple success response
    }
  
    @Delete(':propertyId') // Expect propertyId in the URL path
    @HttpCode(HttpStatus.NO_CONTENT) // Standard for successful DELETE
    async removeSavedProperty(
      @Req() req: RequestWithUser,
      @Param('propertyId', ParseUUIDPipe) propertyId: string, // Validate UUID format
    ) {
       if (!req.user || !req.user.id) {
          throw new InternalServerErrorException('User information not found on request.');
      }
      const userId = req.user.id;
      await this.savedPropertiesService.removeSavedProperty(userId, propertyId);
      // No response body needed for 204
    }
  }
  