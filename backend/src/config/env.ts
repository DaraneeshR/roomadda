import "dotenv/config";
import { z } from "zod";

/**
 * Environment configuration. Validated once, at process start, with zod.
 * Invalid or missing configuration aborts the process (fail fast) — we never
 * boot a half-configured server. Secrets live ONLY here, sourced from env.
 */

const csvToArray = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // Data stores
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),

  // Razorpay (payments + webhook verification)
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  // MSG91 (OTP). Template + sender are required for the live sender (prod) but
  // optional locally where the dev SMS stub is used.
  MSG91_AUTH_KEY: z.string().min(1),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),

  // OTP policy
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),
  OTP_MAX_PER_PHONE_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_MAX_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(20),

  // CORS allowlist (comma-separated). Empty = no cross-origin browser access.
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform(csvToArray)
    .pipe(z.array(z.string().url())),

  // Rate limiting (defaults: 100 requests / minute / IP)
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().int().positive().default(60_000),

  // Admin dashboard metrics: rolling window (hours) for the "settled today"
  // payment totals on GET /v1/metrics.
  METRICS_PAYMENTS_WINDOW_HOURS: z.coerce.number().int().positive().default(24),

  // Roomie assistant (public, LLM-backed usage help + masked discovery).
  // ANTHROPIC_API_KEY is the ONLY secret for this feature and is optional: when
  // absent, POST /v1/roomie returns 503 (feature disabled) instead of failing
  // boot. Secrets come from env only, never hardcoded/logged (/CLAUDE.md).
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Default to the most capable model; override to e.g. claude-haiku-4-5 for a
  // cheaper/faster public assistant — env only, never a code change.
  ROOMIE_MODEL: z.string().min(1).default("claude-opus-4-8"),
  ROOMIE_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(4096).default(512),
  // Per-IP/minute and a global hourly ceiling — both Redis-backed — cap abuse
  // and runaway LLM cost.
  ROOMIE_RATE_PER_IP_PER_MINUTE: z.coerce.number().int().positive().default(20),
  ROOMIE_RATE_GLOBAL_PER_HOUR: z.coerce.number().int().positive().default(2000),
  // Ephemeral per-session context lives in Redis with this short TTL. No message
  // content is persisted anywhere else.
  ROOMIE_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  // How many masked listings to retrieve as discovery context per turn.
  ROOMIE_RETRIEVAL_LIMIT: z.coerce.number().int().min(1).max(20).default(8),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:\n");
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".") || "(root)";
    console.error(`  - ${path}: ${issue.message}`);
  }
  console.error("\nFix the above and restart. See backend/.env.example.\n");
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
