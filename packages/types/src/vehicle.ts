import { z } from "zod";

export const VehicleSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  vin: z.string().length(17),
  plate: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().gte(1900),
  mileage: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Vehicle = z.infer<typeof VehicleSchema>;

export const CreateVehicleSchema = VehicleSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateVehicleInput = z.infer<typeof CreateVehicleSchema>;

export const UpdateVehicleSchema = CreateVehicleSchema.partial();

export type UpdateVehicleInput = z.infer<typeof UpdateVehicleSchema>;
