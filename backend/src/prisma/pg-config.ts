import { readFileSync } from "node:fs";
import type { PrismaPg } from "@prisma/adapter-pg";

type PgConfig = Exclude<ConstructorParameters<typeof PrismaPg>[0], string>;

/**
 * Settings for the pg driver behind Prisma, shared by PrismaService and the seed.
 *
 * RDS requires SSL. On AWS, DATABASE_SSL_CA points at the RDS certificate bundle baked
 * into the image, and the server's certificate is verified against it. Locally (Docker
 * Postgres) it is unset and the connection is plain.
 */
export function pgConfig(): PgConfig {
  const caFile = process.env.DATABASE_SSL_CA;
  return {
    connectionString: process.env.DATABASE_URL,
    ...(caFile ? { ssl: { ca: readFileSync(caFile, "utf8"), rejectUnauthorized: true } } : {}),
  };
}
