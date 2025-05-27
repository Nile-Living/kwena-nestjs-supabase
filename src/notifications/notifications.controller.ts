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
  } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { NotificationsService } from './notifications.service';
  import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';
  import { QueryNotificationsDto } from './dto/query-notifications.dto';
  
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
      return this.notificationsService.getUserNotifications(req.user.sub, query);
    }
  
    @Put(':id/read')
    @HttpCode(HttpStatus.OK)
    async markAsRead(@Request() req: any, @Param('id') id: string) {
      await this.notificationsService.markAsRead(req.user.sub, id);
      return { success: true };
    }
  
    @Put('mark-all-read')
    @HttpCode(HttpStatus.OK)
    async markAllAsRead(@Request() req: any) {
      await this.notificationsService.markAllAsRead(req.user.sub);
      return { success: true };
    }
  
    @Post('device-token')
    @HttpCode(HttpStatus.OK)
    async registerDeviceToken(
      @Request() req: any,
      @Body() dto: RegisterDeviceTokenDto,
    ) {
      await this.notificationsService.registerDeviceToken(req.user.sub, dto);
      return { success: true };
    }
  }
  