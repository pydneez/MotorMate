import "dotenv/config";

/**
 * Integration tests run against a SEPARATE database: TEST_DATABASE_URL if set, otherwise
 * DATABASE_URL with the database name replaced by "motormate_test". Refuses to run against
 * anything whose name doesn't end in "_test", so dev data can never be wiped by accident.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) throw new Error("Set DATABASE_URL or TEST_DATABASE_URL in backend/.env");

  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = "/motormate_test";
  if (!url.pathname.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against "${url.pathname.slice(1)}" — use a *_test database`);
  }
  return url.toString();
}
