import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { CustomersModule } from "./customers/customers.module";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory/inventory.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";
import { VehiclesModule } from "./vehicles/vehicles.module";

@Module({
  imports: [PrismaModule, AuthModule, HealthModule, UsersModule, CustomersModule, VehiclesModule, InventoryModule],
})
export class AppModule {}
