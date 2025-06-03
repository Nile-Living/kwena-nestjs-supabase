// src/promotions/promotions.controller.ts
import {
  Controller,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Headers,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { InitiatePromotionDto } from './dto/initiate-promotion.dto';

@Controller('promotions')
export class PromotionsController {
  private readonly logger = new Logger(PromotionsController.name);

  constructor(private readonly promotionsService: PromotionsService) {}

  @Post('initiate')
  @HttpCode(HttpStatus.OK)
  async initiatePromotion(@Body() initiatePromotionDto: InitiatePromotionDto) {
    return this.promotionsService.initiatePromotion(initiatePromotionDto);
  }

  @Post('verify/:reference')
  @HttpCode(HttpStatus.OK)
  async verifyPromotion(@Param('reference') reference: string) {
    return this.promotionsService.verifyAndActivatePromotion(reference);
  }

  @Post('lenco/webhook')
  @HttpCode(HttpStatus.OK)
  async handleLencoWebhook(
    @Body() payload: any,
    @Headers('x-lenco-signature') signature: string,
  ) {
    this.logger.log('Received Lenco webhook request');
    await this.promotionsService.handleLencoWebhook(payload);
    return { received: true };
  }

  @Post('zynle/webhook')
  @HttpCode(HttpStatus.OK)
  async handleZynleWebhook(
    @Body() payload: any,
    @Headers() headers: any,
  ) {
    this.logger.log('Received Zynle webhook request');
    await this.promotionsService.handleZynleWebhook(payload);
    return { received: true };
  }
}