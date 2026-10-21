import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { configureApp } from "./app.setup";
import { HealthModule } from "./health/health.module";

describe("configureApp", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it("serves routes under /v1 (the load balancer's health check path)", async () => {
    await request(app.getHttpServer()).get("/v1").expect(200, "MotorMate API");
  });

  it("no longer serves routes without the prefix", async () => {
    await request(app.getHttpServer()).get("/").expect(404);
  });
});
