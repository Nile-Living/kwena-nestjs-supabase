import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { User as SupabaseUser } from "@supabase/supabase-js"; // Import Supabase User type

/**
 * Custom decorator to extract the authenticated Supabase user object from the request.
 * Assumes that the JwtAuthGuard (using JwtStrategy) has run and attached the user to request.user.
 *
 * @example
 * someControllerMethod(@GetUser() user: SupabaseUser) {
 *   // user will be the SupabaseUser object
 * }
 *
 * @example
 * someControllerMethod(@GetUser('id') userId: string) {
 *   // userId will be user.id
 * }
 */
export const GetUser = createParamDecorator(
  (data: keyof SupabaseUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as SupabaseUser; // Type assertion

    if (!user) {
      // This should ideally not happen if JwtAuthGuard is applied correctly
      // and the token is valid, as JwtStrategy would throw UnauthorizedException.
      // However, as a safeguard or for clarity:
      console.warn(
        "GetUser decorator: No user object found on request. Ensure JwtAuthGuard is active and token is valid.",
      );
      return null; // Or throw an error, depending on desired strictness
    }

    return data ? user?.[data] : user;
  },
);
