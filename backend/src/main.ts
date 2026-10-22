import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = process.env.PORT ?? 8080;
  await app.listen(port);
}
// A failed start (database down, port taken) exits with an error, so ECS restarts the task.
bootstrap().catch((error: unknown) => {
  new Logger("Bootstrap").error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
