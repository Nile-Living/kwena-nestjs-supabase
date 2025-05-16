import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  // You can override handleRequest if you need custom error handling
  // For example:
  // handleRequest(err, user, info, context, status) {
  //   if (err || !user) {
  //     throw err || new UnauthorizedException('Could not authenticate with token');
  //   }
  //   return user;
  // }
}
