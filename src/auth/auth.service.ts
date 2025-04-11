// src/auth/auth.service.ts
import { Injectable, Inject, UnauthorizedException, InternalServerErrorException, ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, Session, User } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.constants'; // Adjust path
import { SignUpDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly configService: ConfigService, // Keep if needed for other things
  ) {}

  async signInWithPassword(email: string, password: string): Promise<{ session: Session; user: User }> {
    this.logger.log(`Attempting password sign-in for email: ${email}`);
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      this.logger.error(`Sign-in error for ${email}: ${error.message}`);
      // Map Supabase error to NestJS exceptions
      if (error.message === 'Invalid login credentials') {
        throw new UnauthorizedException('Invalid email or password.');
      }
      throw new InternalServerErrorException(`Authentication failed: ${error.message}`);
    }

    if (!data.session || !data.user) {
         this.logger.error(`Sign-in failed for ${email}: No session or user returned.`);
         throw new InternalServerErrorException('Sign-in failed. Please try again.');
    }

    this.logger.log(`Sign-in successful for user: ${data.user.id}`);
    return { session: data.session, user: data.user };
  }

  async signUpAndCreateProfile(signUpDto: SignUpDto): Promise<{ session: Session | null; user: User | null }> {
    const { email, password, phone } = signUpDto;
    this.logger.log(`Attempting sign-up for email: ${email}`);

    // 1. Attempt Supabase Auth Sign Up
    const { data: authData, error: signUpError } = await this.supabase.auth.signUp({
      email,
      password,
      // options: { data: { phone: phone } } // Option: Add phone to auth metadata if desired
    });

    if (signUpError) {
      this.logger.error(`Sign-up error for ${email}: ${signUpError.message}`);
      // Handle specific errors like user already registered
      if (signUpError.message.includes('User already registered')) {
          throw new ConflictException('A user with this email already exists.');
      }
      throw new InternalServerErrorException(`Sign-up failed: ${signUpError.message}`);
    }

     // Check if user needs email confirmation - session might be null initially
    if (!authData.user) {
         this.logger.error(`Sign-up potentially requires confirmation for ${email}, no user object returned immediately.`);
         // Depending on your flow, you might return success here or throw an error
         // For simplicity, we'll assume direct user creation or handle confirmation flow separately
         // If confirmation is needed, the session will be null.
         // throw new InternalServerErrorException('Sign-up requires email confirmation or failed unexpectedly.');
         // OR return success indication for confirmation flow
         return { session: authData.session, user: authData.user }; // User might be null if confirmation needed
    }

    this.logger.log(`Auth sign-up successful for user: ${authData.user.id}. Attempting profile creation.`);

    // 2. Create Profile Entry (only if auth sign-up returned a user)
    try {
        const { error: profileError } = await this.supabase
            .from('profiles')
            .insert([
                {
                    id: authData.user.id, // Use the ID from the auth user
                    email: authData.user.email,
                    phone: phone, // Save phone number
                    // Initialize other fields as null or default
                    full_name: null,
                    avatar_url: null,
                }
            ])
            .select(); // Use select() to check if insert worked (optional)

        if (profileError) {
            // This is critical. If profile creation fails, we might want to roll back auth user?
            // Supabase doesn't have easy transactions across Auth and DB.
            // Log the error prominently. The user exists in auth but not profiles.
            this.logger.error(`Failed to create profile for user ${authData.user.id} after sign-up: ${profileError.message}`, profileError.stack);
            // Decide on behavior: Throw error? Or let user exist without profile?
            // Throwing error might be better to signal incomplete setup.
            throw new InternalServerErrorException(`User signed up, but profile creation failed: ${profileError.message}`);
        }
         this.logger.log(`Profile created successfully for user: ${authData.user.id}`);

    } catch (profileCatchError) {
         // Catch potential errors from the insert operation itself
         this.logger.error(`Caught error during profile creation for user ${authData.user.id}: ${profileCatchError.message}`, profileCatchError.stack);
         throw new InternalServerErrorException(`User signed up, but profile creation failed: ${profileCatchError.message}`);
    }


    // Return session and user from the initial auth sign-up response
    return { session: authData.session, user: authData.user };
  }

  // Add other auth-related backend methods if needed (e.g., password reset)
}
