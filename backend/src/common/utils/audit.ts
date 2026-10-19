import { Prisma } from "@prisma/client";

/** Anything with an auditLog delegate: the PrismaService or a transaction client. */
type AuditWriter = { auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown> } };

export type AuditEntry = {
  /** Null for system actions. */
  actorId: string | null;
  /** Dotted verb, e.g. "vehicle.mileageCorrected". */
  action: string;
  entity: string;
  entityId: string;
  /** Before/after values or other context. Never include passwords or hashes. */
  changes?: Prisma.InputJsonValue;
};

/** Writes one AuditLog row. Call it inside the same transaction as the change it records. */
export function writeAudit(db: AuditWriter, entry: AuditEntry): Promise<unknown> {
  return db.auditLog.create({ data: entry });
}

/**
 * Builds a {field: {from, to}} diff of the fields in `next` that actually changed
 * (`undefined` means "not sent"). Values are plain scalars, so the result is valid JSON.
 */
export function diffFields(previous: object, next: object): Prisma.InputJsonObject {
  const before = previous as Record<string, unknown>;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(next)) {
    if (to !== undefined && to !== before[key]) {
      changes[key] = { from: before[key] ?? null, to };
    }
  }
  return changes as Prisma.InputJsonObject;
}
