import { z } from "zod";
import { wholeNumber } from "./common";
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
  /** Invoice total in THB, if invoiced. */
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

/** plateNormalized is derived server-side with normalizePlate, never sent by clients. */
export const CreateVehicleSchema = z.object({
  /** Required for staff; ignored for customers, who can only add to their own record. */
  customerId: z.string().min(1).optional(),
  vin: VinSchema,
  plate: ThaiPlateSchema,
  province: ThaiProvinceSchema,
  make: z.string().trim().min(1, "Make is required"),
  model: z.string().trim().min(1, "Model is required"),
  year: wholeNumber("Year", (n) =>
    n.gte(1950, "Year looks too old").lte(new Date().getFullYear() + 1, "Year is in the future"),
  ),
  color: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
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
    color: z
      .string()
      .trim()
      .transform((value) => value || null),
  })
  .partial()
  .strict();

export type UpdateVehicleInput = z.input<typeof UpdateVehicleSchema>;

export const MileageCorrectionSchema = z.object({
  mileage: wholeNumber("Mileage", (n) => n.nonnegative("Mileage can't be negative")),
  reason: z.string().trim().min(3, "Give a reason for the correction"),
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
