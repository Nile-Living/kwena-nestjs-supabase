import { IsLatitude, IsLongitude, IsNotEmpty, IsString } from 'class-validator';

export class CoordinatesDto {
  @IsNotEmpty()
  @IsLatitude()
  latitude: number;

  @IsNotEmpty()
  @IsLongitude()
  longitude: number;
}

export class NearbyPlaceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  distance: string;

  @IsString()
  @IsNotEmpty()
  icon: string;
}


