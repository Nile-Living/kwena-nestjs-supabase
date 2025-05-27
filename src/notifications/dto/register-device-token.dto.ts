import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class RegisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsIn(['ios', 'android', 'web'])
  platform: string;
}