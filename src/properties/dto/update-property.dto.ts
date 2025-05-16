import { PartialType } from "@nestjs/mapped-types";
import { CreatePropertyDto } from "./create-property.dto";
import { IsOptional, IsArray, IsString } from "class-validator";

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  existingImageUrls?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deletedImagePublicIds?: string[];
}
