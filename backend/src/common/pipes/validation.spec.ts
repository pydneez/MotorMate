import { BadRequestException } from "@nestjs/common";
import type { ZodTypeAny } from "zod";
import {
  AddLabourSchema,
  AddPartSchema,
  allowedNextStatuses,
  calculateTotals,
  ChangePasswordSchema,
  CreateCustomerSchema,
  CreateWorkOrderSchema,
  parseWorkOrderNumber,
  WorkOrderListQuerySchema,
  CreateInventoryItemSchema,
  CreateStaffSchema,
  CreateVehicleSchema,
  ListQuerySchema,
  MileageCorrectionSchema,
  ReceiveStockSchema,
  RegisterSchema,
  ResetPasswordSchema,
  StocktakeSchema,
  UpdateCustomerSchema,
  UpdateInventoryItemSchema,
  UpdateOwnCustomerSchema,
  UpdateStaffSchema,
  UpdateVehicleSchema,
  WalkInCheckInSchema,
} from "@motormate/types";
import { searchTokens } from "../utils/pagination";
import { phoneSearchFragment } from "../utils/phone-search";
import { ZodValidationPipe } from "./zod-validation.pipe";

/** Runs a value through the pipe exactly as a controller would. */
function validate(schema: ZodTypeAny, value: unknown) {
  return new ZodValidationPipe(schema).transform(value);
}

function fieldErrors(schema: ZodTypeAny, value: unknown): Record<string, string[]> {
  try {
    validate(schema, value);
  } catch (error) {
    if (error instanceof BadRequestException) return (error.getResponse() as { errors: Record<string, string[]> }).errors;
    throw error;
  }
  throw new Error("Expected validation to fail");
}

const validVehicle = {
  vin: "mrhfc1650kp000001",
  plate: "1กข 1234",
  province: "กรุงเทพมหานคร",
  make: "Honda",
  model: "Civic",
  year: "2019",
  mileage: "42000",
};

describe("ZodValidationPipe", () => {
  it("cleans valid input: trims, lowercases email, normalizes phone, strips unknown fields", () => {
    const result = validate(CreateCustomerSchema, {
      firstName: "  Jordan ",
      lastName: "Lee",
      phone: "081-234-5678",
      email: " Jordan.Lee@Example.com ",
      isAdmin: true,
    });

    expect(result).toEqual({
      firstName: "Jordan",
      lastName: "Lee",
      phone: "+66812345678",
      email: "jordan.lee@example.com",
    });
  });

  it("returns per-field messages for missing and invalid fields", () => {
    const errors = fieldErrors(CreateCustomerSchema, { firstName: "", phone: "12345" });

    expect(errors.firstName).toEqual(["First name is required"]);
    expect(errors.lastName).toBeDefined();
    expect(errors.phone).toEqual(["Enter a valid Thai phone number"]);
  });

  it("treats an empty email on create as no email", () => {
    expect(validate(CreateCustomerSchema, { firstName: "A", lastName: "B", phone: "021234567", email: "" }).email).toBeUndefined();
  });
});

describe("vehicle rules", () => {
  it("accepts a valid vehicle and coerces form strings to numbers, uppercasing the VIN", () => {
    const result = validate(CreateVehicleSchema, validVehicle);
    expect(result).toEqual(expect.objectContaining({ vin: "MRHFC1650KP000001", year: 2019, mileage: 42000 }));
  });

  it.each([
    ["too short", "MRHFC1650KP00001"],
    ["contains I", "MRHFC1650KP00000I"],
    ["contains O", "MRHFC1650KPO00001"],
    ["contains Q", "MRHFC1650KPQ00001"],
  ])("rejects a VIN that is %s", (_label, vin) => {
    expect(fieldErrors(CreateVehicleSchema, { ...validVehicle, vin }).vin).toBeDefined();
  });

  it.each(["70-1234", "1กข 1234", "กข-1234"])("accepts the plate %s", (plate) => {
    expect(() => validate(CreateVehicleSchema, { ...validVehicle, plate })).not.toThrow();
  });

  it.each(["ABC 1234", "กขค", "<script>"])("rejects the plate %s", (plate) => {
    expect(fieldErrors(CreateVehicleSchema, { ...validVehicle, plate }).plate).toBeDefined();
  });

  it("rejects an unknown province", () => {
    expect(fieldErrors(CreateVehicleSchema, { ...validVehicle, province: "Bangkok" }).province).toEqual([
      "Choose a province",
    ]);
  });

  it("rejects negative mileage and a year in the future", () => {
    const errors = fieldErrors(CreateVehicleSchema, {
      ...validVehicle,
      mileage: "-5",
      year: String(new Date().getFullYear() + 2),
    });
    expect(errors.mileage).toEqual(["Mileage can't be negative"]);
    expect(errors.year).toEqual(["Year is in the future"]);
  });

  it("refuses mileage (and owner) on a normal vehicle edit", () => {
    expect(() => validate(UpdateVehicleSchema, { mileage: 1000 })).toThrow(BadRequestException);
    expect(() => validate(UpdateVehicleSchema, { customerId: "cust-2" })).toThrow(BadRequestException);
  });

  it("lets an edit clear the color", () => {
    expect(validate(UpdateVehicleSchema, { color: "" })).toEqual({ color: null });
  });

  it("treats a blank mileage or year as missing, not as 0", () => {
    const errors = fieldErrors(CreateVehicleSchema, { ...validVehicle, mileage: "", year: "" });
    expect(errors.mileage).toEqual(["Mileage is required"]);
    expect(errors.year).toEqual(["Year is required"]);
    expect(fieldErrors(MileageCorrectionSchema, { mileage: "", reason: "Typo at check-in" }).mileage).toEqual([
      "Mileage is required",
    ]);
  });

  it("rejects non-numeric and fractional mileage", () => {
    expect(fieldErrors(CreateVehicleSchema, { ...validVehicle, mileage: "abc" }).mileage).toEqual([
      "Mileage must be a number",
    ]);
    expect(fieldErrors(CreateVehicleSchema, { ...validVehicle, mileage: "12.5" }).mileage).toEqual([
      "Mileage must be a whole number",
    ]);
  });

  it("requires a reason for a mileage correction and rejects negatives", () => {
    const errors = fieldErrors(MileageCorrectionSchema, { mileage: -1, reason: "" });
    expect(errors.mileage).toBeDefined();
    expect(errors.reason).toEqual(["Give a reason for the correction"]);
  });
});

describe("account rules", () => {
  it("refuses an email change in a customer's own profile update", () => {
    expect(() => validate(UpdateOwnCustomerSchema, { email: "new@example.com" })).toThrow(BadRequestException);
  });

  it("lets a customer clear their LINE ID", () => {
    expect(validate(UpdateOwnCustomerSchema, { lineId: "" })).toEqual({ lineId: null });
  });

  it("refuses to create a CUSTOMER through staff management", () => {
    const errors = fieldErrors(CreateStaffSchema, {
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      role: "CUSTOMER",
      temporaryPassword: "password123",
    });
    expect(errors.role).toBeDefined();
  });

  it("rejects a short temporary password", () => {
    const errors = fieldErrors(CreateStaffSchema, {
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      role: "MECHANIC",
      temporaryPassword: "short",
    });
    expect(errors.temporaryPassword).toEqual(["Password must be at least 8 characters"]);
  });

  it("rejects a new password that is too short or the same as the current one", () => {
    expect(fieldErrors(ChangePasswordSchema, { currentPassword: "password123", newPassword: "short" }).newPassword).toBeDefined();
    expect(
      fieldErrors(ChangePasswordSchema, { currentPassword: "password123", newPassword: "password123" }).newPassword,
    ).toEqual(["New password must be different from the current one"]);
  });
});

describe("list query", () => {
  it("defaults page and pageSize and drops an empty search", () => {
    expect(validate(ListQuerySchema, { q: "  " })).toEqual({ q: undefined, page: 1, pageSize: 20 });
  });

  it("rejects page 0 and an oversized page", () => {
    expect(() => validate(ListQuerySchema, { page: "0" })).toThrow(BadRequestException);
    expect(() => validate(ListQuerySchema, { pageSize: "1000" })).toThrow(BadRequestException);
  });
});

describe("phoneSearchFragment", () => {
  it.each([
    ["0812345678", "812345678"],
    ["081-234-5678", "812345678"],
    ["+66 81 234 5678", "812345678"],
    ["66812345678", "812345678"],
    ["081 234", "81234"],
    ["02-123-4567", "21234567"],
  ])("turns %s into %s", (typed, fragment) => {
    expect(phoneSearchFragment(typed)).toBe(fragment);
  });

  it.each(["jordan", "08", ""])("ignores %p (not enough digits)", (typed) => {
    expect(phoneSearchFragment(typed)).toBeNull();
  });
});

describe("searchTokens", () => {

  it("splits words so each must match", () => {
    expect(searchTokens("jordan  lee")).toEqual(["jordan", "lee"]);
  });

  it.each(["081 234 5678", "+66 81 234 5678", "(02) 123-4567"])("keeps the phone number %s as one token", (q) => {
    expect(searchTokens(q)).toEqual([q]);
  });

  it("returns no tokens for an empty search", () => {
    expect(searchTokens(undefined)).toEqual([]);
  });
});

/**
 * Forms validate in the browser and then send the PARSED result, which the API parses again
 * with the same schema. So every form schema must accept its own output and produce the same
 * value. (A cleared LINE ID used to become null in the browser and then fail on the server.)
 */
describe("form schemas accept their own output (browser → API round trip)", () => {
  const empty = { lineId: "", email: "", notes: "", color: "" };
  const cases: [string, ZodTypeAny, Record<string, unknown>][] = [
    ["RegisterSchema", RegisterSchema, { firstName: "A", lastName: "B", email: "A@B.com", phone: "081 234 5678", lineId: "", password: "password123" }],
    ["CreateCustomerSchema", CreateCustomerSchema, { firstName: "A", lastName: "B", phone: "0812345678", ...empty }],
    ["UpdateCustomerSchema (fields cleared)", UpdateCustomerSchema, { firstName: "A", lastName: "B", phone: "02-123-4567", email: "", lineId: "", notes: "" }],
    ["UpdateCustomerSchema (fields set)", UpdateCustomerSchema, { email: "X@Y.com", lineId: " jordan ", notes: "VIP" }],
    ["UpdateOwnCustomerSchema (cleared)", UpdateOwnCustomerSchema, { phone: "081-234-5678", lineId: "" }],
    ["CreateVehicleSchema", CreateVehicleSchema, { ...validVehicle, color: "", customerId: "cust-1" }],
    ["UpdateVehicleSchema (color cleared)", UpdateVehicleSchema, { plate: "1กข-1234", province: "กรุงเทพมหานคร", vin: "mrhfc1650kp000001", make: "Honda", model: "Civic", year: "2019", color: "" }],
    ["MileageCorrectionSchema", MileageCorrectionSchema, { mileage: "41200", reason: " Typo " }],
    ["CreateStaffSchema", CreateStaffSchema, { firstName: "A", lastName: "B", email: "N@X.com", role: "MECHANIC", temporaryPassword: "temp-pass-1" }],
    ["UpdateStaffSchema", UpdateStaffSchema, { firstName: "A", lastName: "B", role: "ADVISOR" }],
    ["ResetPasswordSchema", ResetPasswordSchema, { temporaryPassword: "temp-pass-1" }],
    ["ChangePasswordSchema", ChangePasswordSchema, { currentPassword: "password123", newPassword: "new-password-1" }],
    ["CreateInventoryItemSchema", CreateInventoryItemSchema, { sku: " flt-cab ", name: "Cabin filter", category: "Filters", unitCost: "150", unitPrice: "290.50", supplier: "", reorderLevel: "5", openingQuantity: "0" }],
    ["UpdateInventoryItemSchema (supplier cleared)", UpdateInventoryItemSchema, { sku: "FLT-CAB", name: "Cabin filter", category: "Filters", unitCost: "150", unitPrice: "290.5", supplier: "", reorderLevel: "5" }],
    ["ReceiveStockSchema", ReceiveStockSchema, { quantity: "10", note: "" }],
    ["StocktakeSchema", StocktakeSchema, { countedQuantity: "0", reason: " Damaged " }],
    ["WalkInCheckInSchema (new customer)", WalkInCheckInSchema, { customerId: "", firstName: "A", lastName: "B", phone: "081 234 5678", email: "", lineId: "", ...validVehicle, color: "", mileageIn: "45000", complaint: "Noise", mechanicId: "" }],
    ["WalkInCheckInSchema (existing customer)", WalkInCheckInSchema, { customerId: "cust-1", firstName: "", lastName: "", phone: "", email: "", lineId: "", ...validVehicle, color: "", mileageIn: "45000", complaint: "Noise", mechanicId: "" }],
  ];

  it.each(cases)("%s", (_name, schema, formInput) => {
    const inBrowser = validate(schema, formInput);
    // JSON drops undefined, exactly like the real request body.
    const sent = JSON.parse(JSON.stringify(inBrowser));
    expect(validate(schema, sent)).toEqual(sent);
  });

  it("treats null as 'clear' on edit forms", () => {
    expect(validate(UpdateCustomerSchema, { lineId: null, email: null, notes: null })).toEqual({
      lineId: null,
      email: null,
      notes: null,
    });
    expect(validate(UpdateVehicleSchema, { color: null })).toEqual({ color: null });
    expect(validate(UpdateOwnCustomerSchema, { lineId: null })).toEqual({ lineId: null });
  });

  it("still rejects a LINE ID that is too long", () => {
    expect(fieldErrors(UpdateOwnCustomerSchema, { lineId: "x".repeat(51) }).lineId).toBeDefined();
  });
});

describe("inventory rules", () => {
  const validItem = { sku: "flt-cab", name: "Cabin filter", category: "Filters", unitCost: "150", unitPrice: "290", reorderLevel: "5", openingQuantity: "3" };

  it("uppercases the SKU and turns form strings into numbers", () => {
    expect(validate(CreateInventoryItemSchema, validItem)).toEqual(
      expect.objectContaining({ sku: "FLT-CAB", unitCost: 150, unitPrice: 290, reorderLevel: 5, openingQuantity: 3 }),
    );
  });

  it.each([["ab cd"], ["x"], ["FLT_CAB"]])("rejects the SKU %p", (sku) => {
    expect(fieldErrors(CreateInventoryItemSchema, { ...validItem, sku }).sku).toBeDefined();
  });

  it("rejects 3 decimals, negative money and a blank price", () => {
    const errors = fieldErrors(CreateInventoryItemSchema, { ...validItem, unitCost: "1.234", unitPrice: "" });
    expect(errors.unitCost).toEqual(["Cost can have at most 2 decimals"]);
    expect(errors.unitPrice).toEqual(["Price is required"]);
    expect(fieldErrors(CreateInventoryItemSchema, { ...validItem, unitCost: "-1" }).unitCost).toEqual(["Cost can't be negative"]);
  });

  it("allows a price below cost (the form only warns)", () => {
    expect(() => validate(CreateInventoryItemSchema, { ...validItem, unitCost: "300", unitPrice: "200" })).not.toThrow();
  });

  it("refuses editing quantity directly, and opening quantity after creation", () => {
    expect(() => validate(UpdateInventoryItemSchema, { quantityOnHand: 5 })).toThrow(BadRequestException);
    expect(() => validate(UpdateInventoryItemSchema, { openingQuantity: 5 })).toThrow(BadRequestException);
  });

  it("requires a positive received quantity and a stocktake reason", () => {
    expect(fieldErrors(ReceiveStockSchema, { quantity: "0" }).quantity).toEqual(["Quantity must be at least 1"]);
    expect(fieldErrors(StocktakeSchema, { countedQuantity: "2", reason: "" }).reason).toEqual(["Give a reason for the difference"]);
    expect(fieldErrors(StocktakeSchema, { countedQuantity: "", reason: "Count" }).countedQuantity).toEqual([
      "Counted quantity is required",
    ]);
  });
});

describe("work order rules (shared with the frontend)", () => {
  it("gives advisors every next status and mechanics only their own job's non-final ones", () => {
    expect(allowedNextStatuses("QUALITY_CHECK", { role: "ADVISOR", isAssignedMechanic: false })).toEqual([
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
    ]);
    expect(allowedNextStatuses("QUALITY_CHECK", { role: "MECHANIC", isAssignedMechanic: true })).toEqual(["IN_PROGRESS"]);
    expect(allowedNextStatuses("DIAGNOSING", { role: "MECHANIC", isAssignedMechanic: false })).toEqual([]);
    expect(allowedNextStatuses("IN_PROGRESS", { role: "CUSTOMER", isAssignedMechanic: true })).toEqual([]);
    expect(allowedNextStatuses("COMPLETED", { role: "ADMIN", isAssignedMechanic: false })).toEqual([]);
  });

  it("computes totals in satang with VAT rounded half-up", () => {
    expect(calculateTotals([500], [{ quantity: 1, unitPrice: 950 }, { quantity: 1, unitPrice: 220 }])).toEqual({
      labour: 500,
      parts: 1170,
      subtotal: 1670,
      vatRate: 0.07,
      vat: 116.9,
      total: 1786.9,
    });
    expect(calculateTotals([0.1, 0.2], [{ quantity: 3, unitPrice: 0.1 }]).subtotal).toBe(0.6);
    expect(calculateTotals([0.5], []).vat).toBe(0.04); // 3.5 satang rounds up
    expect(calculateTotals([], [])).toEqual(expect.objectContaining({ subtotal: 0, vat: 0, total: 0 }));
  });

  it.each([
    ["WO-0007", 7],
    ["wo7", 7],
    ["007", 7],
    ["abc", null],
    ["WO-", null],
  ])("reads %p as work order number %p", (input, expected) => {
    expect(parseWorkOrderNumber(input)).toBe(expected);
  });

  it("validates check-in, parts and labour input", () => {
    expect(fieldErrors(CreateWorkOrderSchema, { vehicleId: "", mileageIn: "", complaint: " " })).toEqual(
      expect.objectContaining({ vehicleId: expect.any(Array), mileageIn: ["Mileage is required"], complaint: expect.any(Array) }),
    );
    expect(validate(CreateWorkOrderSchema, { vehicleId: "v", mileageIn: "45000", complaint: "x", mechanicId: "" })).toEqual({
      vehicleId: "v",
      mileageIn: 45000,
      complaint: "x",
    });
    expect(fieldErrors(AddPartSchema, { inventoryItemId: "a", quantity: "0" }).quantity).toEqual(["Quantity must be at least 1"]);
    expect(fieldErrors(AddLabourSchema, { description: "x", laborCost: "1.234" }).laborCost).toBeDefined();
  });

  it("accepts the list filters and rejects bad dates or statuses", () => {
    expect(validate(WorkOrderListQuerySchema, { status: "open", mechanic: "me", from: "2026-10-20" })).toEqual(
      expect.objectContaining({ status: "open", mechanic: "me", from: "2026-10-20" }),
    );
    expect(() => validate(WorkOrderListQuerySchema, { from: "20/10/2026" })).toThrow(BadRequestException);
    expect(() => validate(WorkOrderListQuerySchema, { status: "DONE" })).toThrow(BadRequestException);
  });
});
