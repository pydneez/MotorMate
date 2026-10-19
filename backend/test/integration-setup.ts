import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./integration-env";

/** Jest globalSetup: bring the test database schema up to date before any suite runs. */
export default function setup(): void {
  execSync("pnpm exec prisma migrate deploy", {
    cwd: `${__dirname}/..`,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: "pipe",
  });
}
