import { Module } from "@nestjs/common";
import { AppointmentsModule } from "./appointments/appointments.module";
import { AuthModule } from "./auth/auth.module";
import { CustomersModule } from "./customers/customers.module";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory/inventory.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RemindersModule } from "./reminders/reminders.module";
import { UsersModule } from "./users/users.module";
import { VehiclesModule } from "./vehicles/vehicles.module";
import { WorkOrdersModule } from "./work-orders/work-orders.module";

@Module({
  imports: [PrismaModule, AuthModule, HealthModule, UsersModule, CustomersModule, VehiclesModule, InventoryModule, WorkOrdersModule, InvoicesModule, AppointmentsModule, NotificationsModule, RemindersModule],
})
export class AppModule {}
