import { Module } from "@nestjs/common";
import { SavedPropertiesService } from "./saved-properties.services";
import { SavedPropertiesController } from "./saved-properties.controller";

@Module({
//   imports: [],
  controllers: [SavedPropertiesController],
  providers: [SavedPropertiesService],
  exports: [SavedPropertiesService],
})

export class SavedPropertiesModule {}