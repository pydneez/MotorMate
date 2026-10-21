import type { INestApplication } from "@nestjs/common";

/**
 * Every route lives under /v1. On AWS one load balancer serves both apps and sends /v1/* to
 * the backend, everything else to the frontend; locally the prefix is the same so both match.
 */
export const API_PREFIX = "v1";

/** HTTP setup shared by main.ts and the tests that check it. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? "http://localhost:3000",
    credentials: true,
  });
}
