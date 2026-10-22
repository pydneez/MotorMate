import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import {
  CloseRecommendationSchema,
  ListQuerySchema,
  ReminderListQuerySchema,
  type AuthUser,
  type DailyJobsSummary,
  type ListQuery,
  type MyReminder,
  type NotificationEntry,
  type Paginated,
  type ReminderCounts,
  type ReminderItem,
  type ReminderListQuery,
} from "@motormate/types";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RemindersService, type CloseRecommendationData } from "./reminders.service";

/** The staff Reminders page, the customer's "coming up" card, and "Run daily jobs now". */
@Roles("ADMIN", "ADVISOR")
@Controller("reminders")
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ReminderListQuerySchema)) query: ReminderListQuery): Promise<Paginated<ReminderItem>> {
    return this.reminders.list(query);
  }

  @Get("counts")
  counts(): Promise<ReminderCounts> {
    return this.reminders.counts();
  }

  @Get("history")
  history(@Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery): Promise<Paginated<NotificationEntry>> {
    return this.reminders.history(query);
  }

  @Get("mine")
  @Roles("CUSTOMER")
  mine(@CurrentUser() user: AuthUser): Promise<MyReminder[]> {
    return this.reminders.mine(user);
  }

  @Patch("recommendations/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  close(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CloseRecommendationSchema)) body: CloseRecommendationData,
  ): Promise<void> {
    return this.reminders.close(user, id, body);
  }

  /** Both daily jobs now — safe at any time (close-day only touches days that have ended). */
  @Post("run")
  @HttpCode(HttpStatus.OK)
  run(): Promise<DailyJobsSummary> {
    return this.reminders.runAll();
  }
}
