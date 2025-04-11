// src/auth/auth.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus, ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInDto, SignUpDto } from './dto/auth.dto';

@Controller('auth') // Base route /api/auth
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signin')
  @HttpCode(HttpStatus.OK) // Return 200 on successful sign-in
  async signIn(@Body(ValidationPipe) signInDto: SignInDto) {
    // Service handles errors and returns session/user or throws exception
    const { session, user } = await this.authService.signInWithPassword(signInDto.email, signInDto.password);
    // Return session and user info needed by the frontend store
    return {
        accessToken: session.access_token,
        refreshToken: session.refresh_token, // Include if frontend needs it
        expiresIn: session.expires_in,
        user: { // Selectively return user fields
            id: user.id,
            email: user.email,
            // Add other relevant user fields if needed
        }
    };
  }

  @Post('signup')
  @HttpCode(HttpStatus.CREATED) // Return 201 on successful sign-up
  async signUp(@Body(ValidationPipe) signUpDto: SignUpDto) {
    // Service handles sign-up and profile creation
    const { session, user } = await this.authService.signUpAndCreateProfile(signUpDto);
     // Return session and user info (session might be null if confirmation needed)
     // Adjust response based on whether you expect immediate login or confirmation
    return {
        message: user ? 'Sign up successful.' : 'Sign up successful, please check your email for confirmation.', // Example message
        accessToken: session?.access_token,
        refreshToken: session?.refresh_token,
        expiresIn: session?.expires_in,
        user: user ? { id: user.id, email: user.email } : null
    };
  }
}
