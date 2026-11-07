import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { runRequest } from "./tenancy";

/** Gives every request its own shop context (filled in by JwtStrategy). See tenancy.ts. */
@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  use(_request: Request, _response: Response, next: NextFunction): void {
    runRequest(next);
  }
}
