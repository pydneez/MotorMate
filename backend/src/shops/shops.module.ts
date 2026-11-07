import { Module } from "@nestjs/common";
import { PlatformController, ShopsController } from "./shops.controller";
import { ShopsService } from "./shops.service";

@Module({
  controllers: [ShopsController, PlatformController],
  providers: [ShopsService],
})
export class ShopsModule {}
