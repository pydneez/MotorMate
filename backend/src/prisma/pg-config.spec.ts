import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pgConfig } from "./pg-config";

describe("pgConfig", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("connects without SSL when no CA bundle is configured (local Docker Postgres)", () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5433/motormate";
    delete process.env.DATABASE_SSL_CA;
    expect(pgConfig()).toEqual({ connectionString: "postgresql://u:p@localhost:5433/motormate" });
  });

  it("verifies the server against the CA bundle when DATABASE_SSL_CA is set (RDS)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pg-config-"));
    try {
      const caFile = join(dir, "rds-ca.pem");
      writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
      process.env.DATABASE_URL = "postgresql://u:p@db.example:5432/motormate";
      process.env.DATABASE_SSL_CA = caFile;
      expect(pgConfig()).toEqual({
        connectionString: "postgresql://u:p@db.example:5432/motormate",
        ssl: { ca: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n", rejectUnauthorized: true },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
