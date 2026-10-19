import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { HealthService } from "./health.service";

@Public()
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getStatus(): string {
    return this.healthService.getStatus();
  }
}
