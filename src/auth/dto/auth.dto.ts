// src/auth/dto/auth.dto.ts (NestJS)
import { IsEmail, IsString, MinLength, Matches, IsIn } from "class-validator";

export class SignInDto {
  @IsEmail({}, { message: "Please enter a valid email address." })
  email: string;

  @IsString()
  @MinLength(6, { message: "Password must be at least 6 characters long." })
  password: string;
}

export class SignUpDto extends SignInDto {
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: "Phone number must be in E.164 format (e.g., +260...).",
  })
  phone: string;

  @IsString()
  @IsIn(["user", "agent"], { message: "Invalid user type selected." })
  role: "user" | "agent";
}
