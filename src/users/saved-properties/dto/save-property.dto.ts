import { IsUUID } from "class-validator";

export class SavePropertyDto {
    @IsUUID('4', {message: 'Invalid Property ID format.'})
    propertyId: string;
}