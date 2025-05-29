import { PartialType } from "@nestjs/mapped-types";
import { CreateSavedSearchDto } from "./create-saved-search.dto";

export class UpdateSavedSearchDto extends PartialType(CreateSavedSearchDto) {}