// src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
// Remove unused Supabase imports if not fetching user details here
// import { SupabaseClient } from '@supabase/supabase-js';
// import { Inject } from '@nestjs/common';
// import { SUPABASE_CLIENT } from 'src/supabase/supabase.constants';

interface JwtPayload {
    sub: string;
    aud: string;
    role: string;
    email?: string;
    iat: number;
    exp: number;
}

interface AuthenticatedUser {
    id: string;
    role: string;
    email?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  // Inject ConfigService correctly
  constructor(private readonly configService: ConfigService) {
    // --- CORRECTED PART ---
    // Get the secret from the *injected instance* before calling super()
    const secretOrKey = configService.get<string>('SUPABASE_JWT_SECRET');

    // Check if the secret was actually retrieved
    if (!secretOrKey) {
      // Throw error during initialization if secret is missing
      throw new Error('SUPABASE_JWT_SECRET is not defined in environment variables or ConfigService failed to load it.');
    }
    // --- END CORRECTION ---

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secretOrKey, // Pass the retrieved secret here
    });

  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub) {
      // Corrected typo: Missing
      throw new UnauthorizedException('Invalid token: Missing subject (sub).');
    }

    const user: AuthenticatedUser = {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
    };
    return user;
  }
}
