import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AppointmentsModule } from "./appointments/appointments.module";
import { AuthModule } from "./auth/auth.module";
import { TenancyMiddleware } from "./common/tenancy/tenancy.middleware";
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
import { ReportsModule } from "./reports/reports.module";
import { ServicesModule } from "./services/services.module";
import { SettingsModule } from "./settings/settings.module";
import { ShopsModule } from "./shops/shops.module";

@Module({
  imports: [PrismaModule, AuthModule, HealthModule, UsersModule, CustomersModule, VehiclesModule, InventoryModule, WorkOrdersModule, InvoicesModule, AppointmentsModule, NotificationsModule, RemindersModule, ReportsModule, SettingsModule, ServicesModule, ShopsModule],
})
export class AppModule implements NestModule {
  /** Every request gets its own shop context (common/tenancy), filled in by JwtStrategy. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenancyMiddleware).forRoutes("*");
  }
}
