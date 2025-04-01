import { IsLatitude, IsLongitude, IsNotEmpty } from 'class-validator';

export class CoordinatesDto {
  @IsNotEmpty()
  @IsLatitude()
  latitude: number;

  @IsNotEmpty()
  @IsLongitude()
  longitude: number;
}
