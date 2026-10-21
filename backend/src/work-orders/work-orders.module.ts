import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { WorkOrdersController } from "./work-orders.controller";
import { WorkOrdersService } from "./work-orders.service";

@Module({
  // Parts used on a job change stock through the inventory module's StockService.
  imports: [InventoryModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
})
export class WorkOrdersModule {}
