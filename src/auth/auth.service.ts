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
    private readonly configService: ConfigService, 
  ) {}

  async signInWithPassword(email: string, password: string): Promise<{ session: Session; user: User }> {
    this.logger.log(`Attempting password sign-in for email: ${email}`);
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      this.logger.error(`Sign-in error for ${email}: ${error.message}`);
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
    const { email, password, phone, role } = signUpDto;
    this.logger.log(`Attempting sign-up for email: ${email} with role: ${role}`);

    const { data: authData, error: signUpError } = await this.supabase.auth.signUp({
      email,
      password,
      
    });

    if (signUpError) {
      this.logger.error(`Sign-up error for ${email}: ${signUpError.message}`);
      if (signUpError.message.includes('User already registered')) {
          throw new ConflictException('A user with this email already exists.');
      }
      throw new InternalServerErrorException(`Sign-up failed: ${signUpError.message}`);
    }

    if (!authData.user) {
         this.logger.error(`Sign-up potentially requires confirmation for ${email}, no user object returned immediately.`);
         
         return { session: authData.session, user: authData.user }; 
    }

    this.logger.log(`Auth sign-up successful for user: ${authData.user.id}. Attempting profile creation.`);

    try {
        const { error: profileError } = await this.supabase
            .from('profiles')
            .insert([
                {
                    id: authData.user.id,
                    email: authData.user.email,
                    phone: phone,
                    role: role,
                    full_name: null,
                    avatar_url: null,
                }
            ])
            .select();
        if (profileError) {
           
            this.logger.error(`Failed to create profile for user ${authData.user.id} after sign-up: ${profileError.message}`, profileError.stack);

            throw new InternalServerErrorException(`User signed up, but profile creation failed: ${profileError.message}`);
        }
         this.logger.log(`Profile created successfully for user: ${authData.user.id}`);

    } catch (profileCatchError) {
         this.logger.error(`Caught error during profile creation for user ${authData.user.id}: ${profileCatchError.message}`, profileCatchError.stack);
         throw new InternalServerErrorException(`User signed up, but profile creation failed: ${profileCatchError.message}`);
    }
    return { session: authData.session, user: authData.user };
  }

}
