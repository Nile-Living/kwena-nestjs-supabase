// src/subscriptions/subscriptions.controller.ts
import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
    Request,
    HttpCode,
    HttpStatus,
    Query,
  } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { SubscriptionsService } from './subscriptions.service';
  import { CreateSubscriptionDto } from './dto/create-subscription.dto';
  import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
  
  @Controller('subscriptions')
  @UseGuards(AuthGuard('jwt'))
  export class SubscriptionsController {
    constructor(private readonly subscriptionsService: SubscriptionsService) {}
  
    @Get('plans')
    @HttpCode(HttpStatus.OK)
    async getSubscriptionPlans() {
      return this.subscriptionsService.getSubscriptionPlans();
    }
  
    @Get('plans/:type')
    @HttpCode(HttpStatus.OK)
    async getSubscriptionPlan(@Param('type') type: string) {
      return this.subscriptionsService.getSubscriptionPlan(type as any);
    }
  
    @Post()
    @HttpCode(HttpStatus.CREATED)
    async createSubscription(
      @Request() req: any,
      @Body() dto: CreateSubscriptionDto,
    ) {
      return this.subscriptionsService.createSubscription(req.user.id, dto);
    }
  
    @Get()
    @HttpCode(HttpStatus.OK)
    async getUserSubscriptions(@Request() req: any) {
      return this.subscriptionsService.getUserSubscriptions(req.user.id);
    }
  
    @Get('active')
    @HttpCode(HttpStatus.OK)
    async getUserActiveSubscription(@Request() req: any) {
      return this.subscriptionsService.getUserActiveSubscription(req.user.id);
    }
  
    @Get('status')
    @HttpCode(HttpStatus.OK)
    async getSubscriptionStatus(@Request() req: any) {
      const isSubscribed = await this.subscriptionsService.isUserSubscribed(req.user.id);
      const features = await this.subscriptionsService.getUserSubscriptionFeatures(req.user.id);
      return { isSubscribed, features };
    }
  
    @Get('features')
    @HttpCode(HttpStatus.OK)
    async getUserFeatures(@Request() req: any) {
      return this.subscriptionsService.getUserSubscriptionFeatures(req.user.id);
    }
  
    @Put(':id')
    @HttpCode(HttpStatus.OK)
    async updateSubscription(
      @Request() req: any,
      @Param('id') id: string,
      @Body() dto: UpdateSubscriptionDto,
    ) {
      return this.subscriptionsService.updateSubscription(req.user.id, id, dto);
    }
  
    @Delete(':id/cancel')
    @HttpCode(HttpStatus.NO_CONTENT)
    async cancelSubscription(@Request() req: any, @Param('id') id: string) {
      await this.subscriptionsService.cancelSubscription(req.user.id, id);
    }
  
    @Put(':id/renew')
    @HttpCode(HttpStatus.OK)
    async renewSubscription(
      @Request() req: any,
      @Param('id') id: string,
      @Body('duration_months') duration_months: number,
    ) {
      return this.subscriptionsService.renewSubscription(req.user.id, id, duration_months);
    }
  
    @Get('actions/:action/check')
    @HttpCode(HttpStatus.OK)
    async canPerformAction(
      @Request() req: any,
      @Param('action') action: string,
    ) {
      const canPerform = await this.subscriptionsService.canUserPerformAction(
        req.user.id,
        action as any,
      );
      return { canPerform };
    }
  
    @Get('saved-searches/limit-check')
    @HttpCode(HttpStatus.OK)
    async canSaveMoreSearches(@Request() req: any) {
      const canSave = await this.subscriptionsService.canUserSaveMoreSearches(req.user.id);
      const currentCount = await this.subscriptionsService.getUserSavedSearchCount(req.user.id);
      const features = await this.subscriptionsService.getUserSubscriptionFeatures(req.user.id);
      
      return {
        canSave,
        currentCount,
        maxAllowed: features?.max_saved_searches || 0,
      };
    }
  }
  