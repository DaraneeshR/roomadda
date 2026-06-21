import { z } from "zod";

/** Liveness — process is up. Cheap, no dependency checks. */
export const livenessResponseSchema = z.object({
  status: z.literal("ok"),
  uptimeSeconds: z.number().int().nonnegative(),
});

/** Readiness — dependencies are reachable (DB + PostGIS + Redis). */
export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.object({
    database: z.string(),
    postgis: z.string(),
    redis: z.string(),
  }),
});

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
