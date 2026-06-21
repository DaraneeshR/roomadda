import { z } from "zod";

/** Validated build-time env. Only VITE_-prefixed vars reach the browser. */
const schema = z.object({ VITE_API_URL: z.string().url() });

const parsed = schema.safeParse({ VITE_API_URL: import.meta.env.VITE_API_URL });
if (!parsed.success) {
  throw new Error(
    `Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}. See .env.example.`,
  );
}

export const env = {
  apiUrl: parsed.data.VITE_API_URL.replace(/\/$/, ""),
};
