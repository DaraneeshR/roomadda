/**
 * @roomadda/shared — single source of truth for cross-app types and the zod
 * schemas that validate them. Real domain contracts (User, PG, Room, Booking,
 * …) are added here later; this placeholder only keeps the package buildable
 * and type-checkable while the skeleton is wired up.
 */
import { z } from "zod";

export * from "./money.js";
export * from "./contracts.js";

/** Liveness payload returned by every service's health endpoint. */
export const healthStatusSchema = z.object({
  status: z.literal("ok"),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
