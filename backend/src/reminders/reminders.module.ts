import { Module } from "@nestjs/common";
import { JobsController } from "./jobs.controller";
import { RemindersController } from "./reminders.controller";
import { RemindersService } from "./reminders.service";

@Module({
  controllers: [RemindersController, JobsController],
  providers: [RemindersService],
})
export class RemindersModule {}
