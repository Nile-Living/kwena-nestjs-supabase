import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
// You might need SupabaseClient later if fetching role in Guards/Services
// import { SupabaseClient } from '@supabase/supabase-js';
// import { Inject } from '@nestjs/common';
// import { SUPABASE_CLIENT } from '../supabase/supabase.constants';

// Interface for the data reliably inside the Supabase JWT payload
interface JwtPayload {
    sub: string; // User ID (Subject)
    aud: string; // Audience
    // Note: 'role' is NOT typically included by default
    email?: string;
    iat: number; // Issued At
    exp: number; // Expiration Time
}

// Interface for the user object attached to the request after validation
// It only contains information directly validated from the token itself.
interface ValidatedUser {
    id: string;
    email?: string;
    // Role is removed here - it's not directly in the token
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly configService: ConfigService) {
    const secretOrKey = configService.get<string>('SUPABASE_JWT_SECRET');
    if (!secretOrKey) {
      throw new Error('SUPABASE_JWT_SECRET is not defined.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secretOrKey,
    });
  }

  async validate(payload: JwtPayload): Promise<ValidatedUser> {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token: Missing subject (sub).');
    }

    const user: ValidatedUser = {
      id: payload.sub,
      email: payload.email, 
    };


    return user;
  }
}
