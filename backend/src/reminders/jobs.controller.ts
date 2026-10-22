import { Controller, ForbiddenException, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { CloseDayJobSummary, MorningJobSummary } from "@motormate/types";
import { Public } from "../common/decorators/public.decorator";
import { RemindersService } from "./reminders.service";

/**
 * The scheduled jobs, called by the Lambda that EventBridge Scheduler runs at 09:00 and
 * 18:30 (Bangkok). There's no user, so instead of a login it needs the shared secret
 * JOB_TOKEN in the `x-job-token` header; without JOB_TOKEN configured the endpoint is off.
 */
@Public()
@Controller("jobs")
export class JobsController {
  constructor(private readonly reminders: RemindersService) {}

  @Post(":job")
  @HttpCode(HttpStatus.OK)
  run(@Param("job") job: string, @Headers("x-job-token") token: string | undefined): Promise<MorningJobSummary | CloseDayJobSummary> {
    const expected = process.env.JOB_TOKEN;
    if (!expected) throw new NotFoundException();
    if (!token || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      throw new ForbiddenException("Invalid job token");
    }
    if (job === "morning") return this.reminders.runMorning();
    if (job === "close-day") return this.reminders.runCloseDay();
    throw new NotFoundException(`Unknown job "${job}"`);
  }
}
