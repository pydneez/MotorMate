import { Controller, ForbiddenException, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { CloseDayJobSummary, MorningJobSummary } from "@motormate/types";
import { Public } from "../common/decorators/public.decorator";
import { runAsShop } from "../common/tenancy/tenancy";
import { PrismaService } from "../prisma/prisma.service";
import { RemindersService } from "./reminders.service";

/** Adds up the per-shop summaries field by field (they're all counts). */
function total<T extends Record<string, number>>(summaries: T[], empty: T): T {
  return summaries.reduce(
    (sum, summary) => Object.fromEntries(Object.keys(sum).map((key) => [key, sum[key] + summary[key]])) as T,
    empty,
  );
}

/**
 * The scheduled jobs, called by the Lambda that EventBridge Scheduler runs at 09:00 and
 * 18:30 (Bangkok). There's no user, so instead of a login it needs the shared secret
 * JOB_TOKEN in the `x-job-token` header; without JOB_TOKEN configured the endpoint is off.
 * With no user there's no shop either: the job runs once per open shop (runAsShop), and the
 * response adds the shops' numbers up.
 */
@Public()
@Controller("jobs")
export class JobsController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(":job")
  @HttpCode(HttpStatus.OK)
  async run(@Param("job") job: string, @Headers("x-job-token") token: string | undefined): Promise<MorningJobSummary | CloseDayJobSummary> {
    const expected = process.env.JOB_TOKEN;
    if (!expected) throw new NotFoundException();
    if (!token || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      throw new ForbiddenException("Invalid job token");
    }
    if (job !== "morning" && job !== "close-day") throw new NotFoundException(`Unknown job "${job}"`);

    const shops = await this.prisma.shop.findMany({ where: { isActive: true }, select: { id: true } });
    if (job === "morning") {
      const results: MorningJobSummary[] = [];
      for (const shop of shops) results.push(await runAsShop(shop.id, () => this.reminders.runMorning()));
      return total(results, { subscriptions: 0, reminders: 0, followUps: 0, appointmentReminders: 0, notConfirmed: 0, noEmail: 0, failed: 0 });
    }
    const results: CloseDayJobSummary[] = [];
    for (const shop of shops) results.push(await runAsShop(shop.id, () => this.reminders.runCloseDay()));
    return total(results, { noShows: 0, expired: 0 });
  }
}
