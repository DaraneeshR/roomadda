import "server-only";
import { z } from "zod";

/**
 * Server-only configuration. The backend URL is read on the server; it is never
 * sent to the client (no NEXT_PUBLIC_ prefix). There are no client secrets.
 */
const schema = z.object({
  BACKEND_API_URL: z.string().url(),
});

export const env = schema.parse({
  BACKEND_API_URL: process.env.BACKEND_API_URL ?? "http://localhost:3001",
});
