import { Global, Module } from "@nestjs/common";
import { NotifierService } from "./notifier.service";

/** Global, so customers, auth, appointments and reminders can all notify customers. */
@Global()
@Module({
  providers: [NotifierService],
  exports: [NotifierService],
})
export class NotificationsModule {}
