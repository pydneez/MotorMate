import { BadRequestException } from "@nestjs/common";
import type { ZodTypeAny } from "zod";
import {
  ChangePasswordSchema,
  CreateCustomerSchema,
  CreateStaffSchema,
  CreateVehicleSchema,
  ListQuerySchema,
  MileageCorrectionSchema,
  RegisterSchema,
  ResetPasswordSchema,
  UpdateCustomerSchema,
  UpdateOwnCustomerSchema,
  UpdateStaffSchema,
  UpdateVehicleSchema,
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
