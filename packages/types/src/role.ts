import { z } from "zod";

export const RoleSchema = z.enum(["ADMIN", "ADVISOR", "MECHANIC", "CUSTOMER"]);

export type Role = z.infer<typeof RoleSchema>;
