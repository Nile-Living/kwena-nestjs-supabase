// src/auth/jwt.strategy.ts (NestJS)
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";

interface JwtPayload {
  sub: string;
  aud: string;
  email?: string;
  iat: number;
  exp: number;
  role?: string;
  app_metadata?: { [key: string]: any };
  user_metadata?: { [key: string]: any };
}

interface ValidatedUser {
  id: string;
  email?: string;
  role?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(private readonly configService: ConfigService) {
    const secretOrKey = configService.get<string>("SUPABASE_JWT_SECRET");
    if (!secretOrKey) {
      throw new Error("SUPABASE_JWT_SECRET is not defined.");
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secretOrKey,
    });
  }

  async validate(payload: JwtPayload): Promise<ValidatedUser> {
    if (!payload.sub) {
      throw new UnauthorizedException("Invalid token: Missing subject (sub).");
    }

    const user: ValidatedUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role || payload.app_metadata?.role || payload.user_metadata?.role,
    };

    return user;
  }
}
