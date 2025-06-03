// src/payments/payments.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Param,
  Get,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { SubmitOtpDto } from './dto/submit-otp.dto';

@Controller('payments')
@UseGuards(AuthGuard('jwt'))
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('provider')
  @HttpCode(HttpStatus.OK)
  async getCurrentProvider() {
    return {
      provider: this.paymentsService.getCurrentProvider(),
    };
  }

  @Post('initiate')
  @HttpCode(HttpStatus.OK)
  async initiatePayment(
    @Request() req: any,
    @Body() dto: InitiatePaymentDto,
  ) {
    return this.paymentsService.initiatePayment(req.user.id, dto);
  }

  @Post('submit-otp')
  @HttpCode(HttpStatus.OK)
  async submitOtp(@Request() req: any, @Body() dto: SubmitOtpDto) {
    return this.paymentsService.submitOtp(req.user.id, dto);
  }

  @Post('verify/:reference')
  @HttpCode(HttpStatus.OK)
  async verifyPayment(
    @Request() req: any,
    @Param('reference') reference: string,
  ) {
    return this.paymentsService.verifyPayment(req.user.id, reference);
  }
}