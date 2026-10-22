import { z } from "zod";
import { blankAsNull, blankAsUndefined, textWithLetters, wholeNumber } from "./common";
import { ThaiPlateSchema, ThaiProvinceSchema } from "./thai";
import type { WorkOrderStatus } from "./work-order";

export const VehicleSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  vin: z.string(),
  plate: z.string(),
  plateNormalized: z.string(),
  province: z.string(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  color: z.string().nullable(),
  mileage: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Vehicle = z.infer<typeof VehicleSchema>;

export type VehicleOwner = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
};

/** Row in the vehicles list / card on a customer page. */
export type VehicleSummary = Vehicle & {
  owner: VehicleOwner;
  lastVisitAt: string | null;
};

/** One completed or in-progress visit on the vehicle's service timeline. */
export type ServiceHistoryEntry = {
  workOrderId: string;
  number: number;
  status: WorkOrderStatus;
  date: string;
  mileageIn: number;
  complaint: string;
  workPerformed: string | null;
  mechanicName: string | null;
  parts: { name: string; quantity: number }[];
  /** Invoice id and total in THB, if invoiced. */
  invoiceId: string | null;
  total: number | null;
  recommendations: { description: string; dueMileage: number | null; dueDate: string | null }[];
};

export type VehicleDetail = VehicleSummary & {
  history: ServiceHistoryEntry[];
};

const VinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O or Q)");

/** Letters (any script), digits, spaces and "- . &": "Mercedes-Benz", "BMW", "Land Rover". */
const MakeSchema = textWithLetters("Make", {
  max: 40,
  allowed: /^[\p{L}\p{M}\d\s.&-]+$/u,
  allowedHint: "letters, digits, spaces, - . and &",
});

/** May be all digits (Toyota 86, Peugeot 3008) — the make already needs a letter. */
const ModelSchema = textWithLetters("Model", {
  max: 60,
  contains: { pattern: /[\p{L}\d]/u, message: "Model must contain letters or digits" },
  allowed: /^[\p{L}\p{M}\d\s./+()-]+$/u,
  allowedHint: "letters, digits, spaces, - . / + and ( )",
});

/** "White", "Dark grey", "Black/White", "ขาว" — never a number. */
const ColorSchema = textWithLetters("Color", {
  max: 30,
  allowed: /^[\p{L}\p{M}\s/-]+$/u,
  allowedHint: "letters, spaces, - and /",
});

/** plateNormalized is derived server-side with normalizePlate, never sent by clients. */
export const CreateVehicleSchema = z.object({
  /** Required for staff; ignored for customers, who can only add to their own record. */
  customerId: z.string().min(1).optional(),
  vin: VinSchema,
  plate: ThaiPlateSchema,
  province: ThaiProvinceSchema,
  make: MakeSchema,
  model: ModelSchema,
  year: wholeNumber("Year", (n) =>
    n.gte(1950, "Year looks too old").lte(new Date().getFullYear() + 1, "Year is in the future"),
  ),
  color: blankAsUndefined(ColorSchema),
  mileage: wholeNumber("Mileage", (n) => n.nonnegative("Mileage can't be negative")),
});

export type CreateVehicleInput = z.input<typeof CreateVehicleSchema>;

/**
 * Mileage and owner are excluded: mileage only increases via work orders or an audited
 * admin correction. `.strict()` rejects them instead of silently ignoring them.
 */
export const UpdateVehicleSchema = CreateVehicleSchema.omit({ mileage: true, customerId: true })
  .extend({
    /** An emptied field clears the color. */
    color: blankAsNull(ColorSchema),
  })
  .partial()
  .strict();

export type UpdateVehicleInput = z.input<typeof UpdateVehicleSchema>;

export const MileageCorrectionSchema = z.object({
  mileage: wholeNumber("Mileage", (n) => n.nonnegative("Mileage can't be negative")),
  reason: textWithLetters("Reason", { min: 3, max: 200, required: "Give a reason for the correction" }),
});

export type MileageCorrectionInput = z.input<typeof MileageCorrectionSchema>;

export const VehicleDuplicateQuerySchema = z
  .object({
    plate: z.string().trim().optional(),
    province: z.string().trim().optional(),
    vin: z.string().trim().toUpperCase().optional(),
    excludeId: z.string().optional(),
  })
  .refine((query) => query.vin || (query.plate && query.province), {
    message: "Provide a VIN, or a plate and province",
  });

export type VehicleDuplicateQuery = z.output<typeof VehicleDuplicateQuerySchema>;

export type VehicleDuplicates = {
  /** Same plate + province — a warning, saving is still allowed. */
  plateMatchCount: number;
  /** The matching vehicles — staff only; always empty for customers (privacy). */
  byPlate: VehicleSummary[];
  /** VIN is unique, so a match blocks saving. */
  vinTaken: boolean;
  /** The vehicle holding the VIN — staff only; always null for customers. */
  byVin: VehicleSummary | null;
};
