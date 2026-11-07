import { z } from "zod";

/** PLATFORM_ADMIN runs the platform (all shops) and belongs to no shop; the rest work in one. */
export const RoleSchema = z.enum(["PLATFORM_ADMIN", "ADMIN", "ADVISOR", "MECHANIC", "CUSTOMER"]);

export type Role = z.infer<typeof RoleSchema>;
