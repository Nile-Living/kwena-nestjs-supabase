// src/auth/auth.controller.ts (NestJS)
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SignInDto, SignUpDto } from "./dto/auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("signin")
  @HttpCode(HttpStatus.OK)
  async signIn(@Body(ValidationPipe) signInDto: SignInDto) {
    const { session, user } = await this.authService.signInWithPassword(
      signInDto.email,
      signInDto.password,
    );
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresIn: session.expires_in,
      user: {
        id: user.id,
        email: user.email,
      },
    };
  }

  @Post("signup")
  @HttpCode(HttpStatus.CREATED)
  async signUp(@Body(ValidationPipe) signUpDto: SignUpDto) {
    const { session, user } =
      await this.authService.signUpAndCreateProfile(signUpDto);
    return {
      message:
        user && session
          ? "Sign up successful."
          : "Sign up successful, please check your email for confirmation.",
      accessToken: session?.access_token,
      refreshToken: session?.refresh_token,
      expiresIn: session?.expires_in,
      user: user ? { id: user.id, email: user.email } : null,
    };
  }
}
