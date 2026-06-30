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
  // Transactional template for the SOS safety alert (live sender only; the dev
  // stub logs instead). Optional locally.
  MSG91_SOS_TEMPLATE_ID: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  // Rent reminders (prod). WhatsApp via the MSG91 BSP is preferred: when the
  // integrated number + approved template are both set, prod sends the WhatsApp
  // template; otherwise it falls back to an SMS flow template; dev no-ops. All
  // optional so dev/test never require a gateway.
  MSG91_WHATSAPP_NUMBER: z.string().optional(),
  MSG91_WHATSAPP_RENT_TEMPLATE: z.string().optional(),
  MSG91_RENT_REMINDER_TEMPLATE_ID: z.string().optional(),
  // Walk-in app-invite SMS (prod): a host records a walk-in tenant and the tenant
  // is SMSed a single-use pre-registration token to claim their RoomAdda account.
  // Live sender only; the dev stub logs instead. Optional locally.
  MSG91_WALKIN_INVITE_TEMPLATE_ID: z.string().optional(),

  // SOS ops alerting — the admin/ops channel that MONITORS emergencies. This is
  // safety-critical: in production at least one channel below MUST be set (the
  // superRefine at the bottom enforces it) so a real SOS reaches a human; set
  // both for redundancy. [MANUAL] the real destinations per environment.
  // Comma-separated E.164 numbers for the on-call ops SMS distribution list.
  SOS_OPS_SMS_NUMBERS: z
    .string()
    .default("")
    .transform(csvToArray)
    .pipe(z.array(z.string().regex(/^\+[1-9]\d{7,14}$/, "must be E.164, e.g. +9198..."))),
  // Ops incoming webhook (Slack / Teams / PagerDuty). May embed a secret token,
  // so it is NEVER logged.
  SOS_OPS_WEBHOOK_URL: z.string().url().optional(),
  // Dedicated MSG91 template for the ops SOS SMS (distinct copy, includes the
  // user's callback number). Required by the live sender only when ops SMS
  // numbers are set; the dev stub logs instead.
  MSG91_SOS_OPS_TEMPLATE_ID: z.string().optional(),

  // KYC document storage (private S3 bucket, SSE AES-256). Required for the live
  // S3 storage in prod; optional locally where the dev storage stub is used.
  // AWS credentials are read from the standard AWS_* env by the SDK directly.
  KYC_S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  // TTL for the presigned upload URLs handed to the client (private + public).
  KYC_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  // Listing photos go to a separate PUBLIC-read bucket (they're served on public
  // listings, unlike the private KYC bucket). Required for the live S3 storage in
  // prod; optional locally where the dev storage stub is used. LISTING_PHOTOS_
  // PUBLIC_BASE_URL is an optional CDN / custom-domain base for the served URLs;
  // when unset the S3 virtual-hosted URL is used.
  LISTING_PHOTOS_S3_BUCKET: z.string().optional(),
  LISTING_PHOTOS_PUBLIC_BASE_URL: z.string().url().optional(),

  // Firebase (chat real-time transport: Firestore + FCM, per PRD). A service
  // account; all three required for the LIVE transport in prod. Optional locally
  // where the chat transport stub is used (messages still mirror to Postgres).
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

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

  // Agent commission (read-only; manual payout in MVP). Basis points of the
  // booking's monthly rent earned per CONFIRMED agent-attributed booking — the
  // SAME rate for assisted and walk-in. 1000 bps = 10%. Tunable via env only.
  AGENT_COMMISSION_BPS: z.coerce.number().int().min(0).max(10_000).default(1000),
  // Public base URL the assisted-booking pay link points at (the USER opens it on
  // their own device). Optional; the dev/stub link sender falls back to a local URL.
  PUBLIC_PAY_BASE_URL: z.string().url().optional(),

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
}).superRefine((val, ctx) => {
  // SOS must reach a real human in production. Refuse to boot a prod server that
  // has no ops alert channel — a logged no-op is acceptable in dev/test only.
  if (val.NODE_ENV === "production" && val.SOS_OPS_SMS_NUMBERS.length === 0 && !val.SOS_OPS_WEBHOOK_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SOS_OPS_SMS_NUMBERS"],
      message:
        "In production set SOS_OPS_SMS_NUMBERS and/or SOS_OPS_WEBHOOK_URL — SOS must deliver to a real ops channel",
    });
  }
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
