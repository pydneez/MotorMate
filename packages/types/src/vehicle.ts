import { z } from "zod";
import { ThaiPlateSchema, ThaiProvinceSchema } from "./thai";

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

/** plateNormalized is derived server-side with normalizePlate, never sent by clients. */
export const CreateVehicleSchema = z.object({
  customerId: z.string().min(1),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O or Q)"),
  plate: ThaiPlateSchema,
  province: ThaiProvinceSchema,
  make: z.string().trim().min(1, "Make is required"),
  model: z.string().trim().min(1, "Model is required"),
  year: z.coerce
    .number()
    .int()
    .gte(1950, "Year looks too old")
    .lte(new Date().getFullYear() + 1, "Year is in the future"),
  color: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  mileage: z.coerce.number().int().nonnegative("Mileage can't be negative"),
});

export type CreateVehicleInput = z.input<typeof CreateVehicleSchema>;

/** Mileage is excluded: it only increases via work orders or an audited admin correction. */
export const UpdateVehicleSchema = CreateVehicleSchema.omit({ mileage: true, customerId: true }).partial();

export type UpdateVehicleInput = z.input<typeof UpdateVehicleSchema>;
