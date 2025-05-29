// src/notifications/notifications.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import { UpdateSavedSearchDto } from './dto/update-saved-search.dto';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getNotifications(
    @Request() req: any,
    @Query() query: QueryNotificationsDto,
  ) {
    return this.notificationsService.getUserNotifications(req.user.id, query); // Changed from req.user.sub
  }

  @Put(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(@Request() req: any, @Param('id') id: string) {
    await this.notificationsService.markAsRead(req.user.id, id); // Changed from req.user.sub
    return { success: true };
  }

  @Put('mark-all-read')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@Request() req: any) {
    await this.notificationsService.markAllAsRead(req.user.id); // Changed from req.user.sub
    return { success: true };
  }

  @Post('device-token')
  @HttpCode(HttpStatus.OK)
  async registerDeviceToken(
    @Request() req: any,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    console.log('NotificationsController: Device token registration request');
    console.log('Request user object:', JSON.stringify(req.user, null, 2));
    console.log('User ID (req.user.id):', req.user.id); // Changed from req.user.sub
    console.log('DTO:', JSON.stringify(dto, null, 2));

    await this.notificationsService.registerDeviceToken(req.user.id, dto); // Changed from req.user.sub
    return { success: true };
  }

  // src/notifications/notifications.controller.ts - Add these routes
  @Get('saved-searches')
  @HttpCode(HttpStatus.OK)
  async getSavedSearches(@Request() req: any) {
    return this.notificationsService.getUserSavedSearches(req.user.id);
  }

  @Post('saved-searches')
  @HttpCode(HttpStatus.CREATED)
  async createSavedSearch(
    @Request() req: any,
    @Body() dto: CreateSavedSearchDto,
  ) {
    return this.notificationsService.createSavedSearch(req.user.id, dto);
  }

  @Put('saved-searches/:id')
  @HttpCode(HttpStatus.OK)
  async updateSavedSearch(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateSavedSearchDto,
  ) {
    return this.notificationsService.updateSavedSearch(req.user.id, id, dto);
  }

  @Delete('saved-searches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSavedSearch(@Request() req: any, @Param('id') id: string) {
    await this.notificationsService.deleteSavedSearch(req.user.id, id);
  }
}
