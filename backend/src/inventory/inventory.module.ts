import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { StockService } from "./stock.service";

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, StockService],
  // Work orders (Step 4) change stock through the same StockService.
  exports: [StockService],
})
export class InventoryModule {}
