import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decoraters/get-user.decorator';
import { TrackEventDto } from './dto/track-event.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Track user events
   * POST /analytics/track
   */
  @Post('track')
  async trackEvent(
    @GetUser() user: any,
    @Body() trackEventDto: TrackEventDto,
  ) {
    await this.analyticsService.trackEvent(user.id, trackEventDto);
    return { success: true, message: 'Event tracked successfully' };
  }

  /**
   * Get user engagement statistics
   * GET /analytics/user/engagement
   */
  @Get('user/engagement')
  async getUserEngagement(
    @GetUser() user: any,
    @Query() query: AnalyticsQueryDto,
  ) {
    const stats = await this.analyticsService.getUserEngagementStats(
      user.id,
      query,
    );
    return {
      success: true,
      data: stats,
    };
  }

  /**
   * Get property statistics (for property owners and premium users)
   * GET /analytics/property/:id
   */
  @Get('property/:id')
  async getPropertyStats(
    @Param('id') propertyId: string,
    @Query() query: AnalyticsQueryDto,
    @GetUser() user: any,
  ) {
    // TODO: Add authorization check - only property owner or premium users
    const stats = await this.analyticsService.getPropertyStats(
      propertyId,
      query,
    );
    return {
      success: true,
      data: stats,
    };
  }

  /**
   * Get subscription statistics (admin only)
   * GET /analytics/subscriptions
   */
  @Get('subscriptions')
  async getSubscriptionStats(@GetUser() user: any) {
    // TODO: Add admin role check
    const stats = await this.analyticsService.getSubscriptionStats();
    return {
      success: true,
      data: stats,
    };
  }

  /**
   * Get top performing properties
   * GET /analytics/properties/top
   */
  @Get('properties/top')
  async getTopProperties(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    const topProperties = await this.analyticsService.getTopProperties(
      limit || 10,
    );
    return {
      success: true,
      data: topProperties,
    };
  }
}