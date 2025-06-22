// src/auth/auth.service.ts
import {
  Injectable,
  Logger,
  InternalServerErrorException,
  UnauthorizedException,
  ConflictException,
  Inject,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseClient, User, Session } from "@supabase/supabase-js";
import { SignUpDto } from "./dto/auth.dto";
import { SUPABASE_ANON_CLIENT } from "../supabase/supabase.constants"; // Ensure this path is correct

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(SUPABASE_ANON_CLIENT) private readonly supabase: SupabaseClient,
    private readonly configService: ConfigService,
  ) {}

  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<{ session: Session; user: User }> {
    this.logger.log(`Attempting password sign-in for email: ${email}`);
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      this.logger.error(`Sign-in error for ${email}: ${error.message}`);
      if (error.message === "Invalid login credentials") {
        throw new UnauthorizedException("Invalid email or password.");
      }
      throw new InternalServerErrorException(
        `Authentication failed: ${error.message}`,
      );
    }
    if (!data.session || !data.user) {
      this.logger.error(
        `Sign-in failed for ${email}: No session or user returned.`,
      );
      throw new InternalServerErrorException(
        "Sign-in failed. Please try again.",
      );
    }
    this.logger.log(`Sign-in successful for user: ${data.user.id}`);
    return { session: data.session, user: data.user };
  }

  async signUpAndCreateProfile(
    signUpDto: SignUpDto,
  ): Promise<{ session: Session | null; user: User | null; message: string }> {
    const { email, password, phone, role } = signUpDto;
    this.logger.log(
      `Attempting sign-up for email: ${email} with role: ${role}`,
    );

    const { data: authData, error: signUpError } =
      await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: { // This data goes into auth.users.raw_user_meta_data
            phone: phone,
            role: role,
            // full_name and avatar_url are not provided here, will be null for email/pass
            // unless user updates their profile later.
          },
        },
      });

    if (signUpError) {
      this.logger.error(`Sign-up error for ${email}: ${signUpError.message}`);
      if (signUpError.message.includes("User already registered")) {
        throw new ConflictException("A user with this email already exists.");
      }
      throw new InternalServerErrorException(
        `Sign-up failed: ${signUpError.message}`,
      );
    }

    // If authData.user is null, it means email confirmation is pending.
    // The trigger will fire once the user confirms their email and is fully in auth.users.
    if (!authData.user && !authData.session) { // Check both, as session might exist if auto-confirm is off but user object is returned by some configurations
      this.logger.warn(
        `Sign-up for ${email} likely requires email confirmation.`,
      );
      return {
        session: authData.session, // Might be null
        user: authData.user,       // Will be null
        message: "Sign up successful, please check your email for confirmation.",
      };
    }

    // If user object exists, sign-up was successful (or auto-confirmed).
    // The DB trigger will handle profile creation.
    this.logger.log(
      `Auth sign-up successful for user: ${authData.user?.id}. Profile creation handled by DB trigger.`,
    );

    return {
      session: authData.session,
      user: authData.user,
      message: authData.user
        ? "Sign up successful."
        : "Sign up process initiated, confirmation may be required.",
    };
  }
}
