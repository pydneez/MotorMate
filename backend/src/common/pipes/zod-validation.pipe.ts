import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodTypeAny, output } from "zod";

/**
 * Validates and transforms a request value with a shared zod schema from @motormate/types,
 * so the API and the frontend forms apply identical rules. Usage:
 *   @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
