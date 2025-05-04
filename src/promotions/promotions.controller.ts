import {
    Controller,
    Post,
    Body,
    Param,
    HttpCode,
    HttpStatus,
    Headers, // Import Headers decorator for webhook validation
    BadRequestException, // For webhook validation failure
    Logger, // For logging webhook issues
  } from '@nestjs/common';
  import { PromotionsService } from './promotions.service';
  import { InitiatePromotionDto } from './dto/initiate-promotion.dto';
  
  @Controller('promotions')
  export class PromotionsController {
    private readonly logger = new Logger(PromotionsController.name); // Add logger
  
    constructor(private readonly promotionsService: PromotionsService) {}
  
    @Post('initiate')
    @HttpCode(HttpStatus.OK)
    async initiatePromotion(@Body() initiatePromotionDto: InitiatePromotionDto) {
      return this.promotionsService.initiatePromotion(initiatePromotionDto);
    }
  
    // This endpoint might become less relevant if relying solely on webhooks
    @Post('verify/:reference')
    @HttpCode(HttpStatus.OK)
    async verifyPromotion(@Param('reference') reference: string) {
      return this.promotionsService.verifyAndActivatePromotion(reference);
    }
  
    // Endpoint for Lenco Webhook
    @Post('lenco/webhook')
    @HttpCode(HttpStatus.OK)
    async handleWebhook(
      @Body() payload: any,
      @Headers('x-lenco-signature') signature: string, // Adjust header name if different
    ) {
      this.logger.log('Received Lenco webhook request');
      // TODO: Implement robust signature validation here before processing
      // if (!signature || !this.promotionsService.isValidSignature(signature, payload)) {
      //    this.logger.warn('Invalid or missing webhook signature');
      //    throw new BadRequestException('Invalid signature');
      // }
      await this.promotionsService.handleLencoWebhook(payload);
      return { received: true }; // Acknowledge receipt
    }
  }
  