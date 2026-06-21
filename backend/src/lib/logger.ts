import { pino, type LoggerOptions } from "pino";
import { env, isDevelopment } from "../config/env.js";

/**
 * Application logger (pino). Sensitive fields are redacted everywhere so
 * tokens / OTPs / PII never reach the logs (see /CLAUDE.md security rules).
 */
const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "*.authorization",
  "*.password",
  "*.otp",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.razorpaySignature",
  "*.razorpay_signature",
  "req.body.password",
  "req.body.otp",
  "req.body.token",
];

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: "[REDACTED]" },
  // In dev, pretty-print; in prod, structured JSON to stdout.
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: { translateTime: "SYS:standard", ignore: "pid,hostname" },
        },
      }
    : {}),
};

export const logger = pino(options);
