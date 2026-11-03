import { InventoryListQuerySchema, InvoiceListQuerySchema, WorkOrderListQuerySchema } from "@motormate/types";
import { bangkokDayFilter } from "./dates";

describe("bangkokDayFilter", () => {
  it("covers whole Bangkok days, both ends inclusive", () => {
    expect(bangkokDayFilter("2026-10-01", "2026-10-31")).toEqual({
      gte: new Date("2026-09-30T17:00:00.000Z"),
      lt: new Date("2026-10-31T17:00:00.000Z"),
    });
    expect(bangkokDayFilter("2026-12-31", "2026-12-31")).toEqual({
      gte: new Date("2026-12-30T17:00:00.000Z"),
      lt: new Date("2026-12-31T17:00:00.000Z"),
    });
  });

  it("allows an open start or end, and is undefined with neither", () => {
    expect(bangkokDayFilter("2026-10-01")).toEqual({ gte: new Date("2026-09-30T17:00:00.000Z") });
    expect(bangkokDayFilter(undefined, "2026-10-31")).toEqual({ lt: new Date("2026-10-31T17:00:00.000Z") });
    expect(bangkokDayFilter()).toBeUndefined();
  });
});

describe("list query date ranges (packages/types)", () => {
  const issue = (schema: typeof InvoiceListQuerySchema | typeof WorkOrderListQuerySchema, query: Record<string, string>) => {
    const result = schema.safeParse(query);
    return result.success ? null : result.error.issues[0];
  };

  it.each([
    ["invoices", InvoiceListQuerySchema],
    ["work orders", WorkOrderListQuerySchema],
  ] as const)("checks from/to on %s", (_name, schema) => {
    expect(issue(schema, {})).toBeNull();
    expect(issue(schema, { from: "2026-10-01" })).toBeNull();
    expect(issue(schema, { to: "2026-10-31" })).toBeNull();
    expect(issue(schema, { from: "2026-10-01", to: "2026-10-01" })).toBeNull();
    // A list has no 12-month limit (unlike reports).
    expect(issue(schema, { from: "2020-01-01", to: "2026-10-31" })).toBeNull();
    expect(issue(schema, { from: "", to: "" })).toBeNull();
    expect(issue(schema, { from: "2026-02-30" })).toEqual(expect.objectContaining({ path: ["from"], message: "Use a real date (yyyy-mm-dd)" }));
    expect(issue(schema, { from: "2026-10-31", to: "2026-10-01" })).toEqual(
      expect.objectContaining({ path: ["to"], message: "The end date can't be before the start date" }),
    );
  });

  it("drops empty dates rather than filtering on them", () => {
    expect(InvoiceListQuerySchema.parse({ from: "", to: "" })).toEqual(expect.not.objectContaining({ from: expect.anything() }));
  });
});

describe("inventory sort (packages/types)", () => {
  it("accepts only the listed columns and directions", () => {
    expect(InventoryListQuerySchema.parse({ sort: "quantity", dir: "desc" })).toEqual(expect.objectContaining({ sort: "quantity", dir: "desc" }));
    expect(InventoryListQuerySchema.parse({})).toEqual(expect.not.objectContaining({ sort: expect.anything() }));
    expect(InventoryListQuerySchema.safeParse({ sort: "unitCost" }).success).toBe(false);
    expect(InventoryListQuerySchema.safeParse({ sort: "name", dir: "up" }).success).toBe(false);
  });
});
