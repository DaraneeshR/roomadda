import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { redis } from "../../lib/redis.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors.js";
import { hitFixedWindow } from "../../lib/rate-limit.js";
import { chat, llmConfigured } from "../../lib/anthropic.js";
import { listingService } from "../listing/listing.service.js";
import { toPublicListing, type PublicListing } from "../listing/serializer.js";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  sanitizeOutput,
  type PriorTurn,
} from "./roomie.prompt.js";

/**
 * Roomie business logic. Order of operations is deliberate:
 *   1. feature gate (503 if no API key) — cheap, no abuse vector,
 *   2. per-IP rate limit, then the global hourly cost ceiling (per-IP first so a
 *      single IP can't burn the shared budget beyond its own allowance),
 *   3. masked-only retrieval + prompt assembly,
 *   4. the LLM call, then output sanitization,
 *   5. write back the short-lived session context.
 * No message content is logged or persisted outside the ephemeral Redis session.
 */

const ONE_MINUTE_SECONDS = 60;
const ONE_HOUR_SECONDS = 60 * 60;
const GLOBAL_WINDOW_KEY = "roomie:rl:global:hour";

// Ephemeral session context: a tiny rolling trail, each turn clipped, short TTL.
const SESSION_PREFIX = "roomie:sess:";
const MAX_TURNS = 4;
const MAX_STORED_CHARS = 600;

const rateLimited = (): AppError =>
  new AppError({
    statusCode: 429,
    code: "ROOMIE_RATE_LIMITED",
    message: "You're sending messages too quickly. Please slow down and try again shortly.",
  });

const unavailable = (): AppError =>
  new AppError({
    statusCode: 503,
    code: "ROOMIE_UNAVAILABLE",
    message: "Roomie is unavailable right now. Please try again later.",
    expose: true,
  });

/** Per-IP/minute, then a global hourly ceiling. Throws 429 on breach. */
async function enforceRateLimits(ip: string): Promise<void> {
  const perIp = await hitFixedWindow(
    redis,
    `roomie:rl:ip:${ip}`,
    env.ROOMIE_RATE_PER_IP_PER_MINUTE,
    ONE_MINUTE_SECONDS,
  );
  if (!perIp.allowed) throw rateLimited();

  const global = await hitFixedWindow(
    redis,
    GLOBAL_WINDOW_KEY,
    env.ROOMIE_RATE_GLOBAL_PER_HOUR,
    ONE_HOUR_SECONDS,
  );
  if (!global.allowed) throw rateLimited();
}

const isPriorTurn = (value: unknown): value is PriorTurn =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as PriorTurn).q === "string" &&
  typeof (value as PriorTurn).a === "string";

async function loadHistory(sessionId: string): Promise<PriorTurn[]> {
  const raw = await redis.get(SESSION_PREFIX + sessionId);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPriorTurn).slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

const clip = (text: string): string =>
  text.length > MAX_STORED_CHARS ? text.slice(0, MAX_STORED_CHARS) : text;

async function saveHistory(
  sessionId: string,
  history: PriorTurn[],
  question: string,
  answer: string,
): Promise<void> {
  const next = [...history, { q: clip(question), a: clip(answer) }].slice(-MAX_TURNS);
  // Short TTL — this is transient session context, not durable storage.
  await redis.set(
    SESSION_PREFIX + sessionId,
    JSON.stringify(next),
    "EX",
    env.ROOMIE_SESSION_TTL_SECONDS,
  );
}

/**
 * Retrieve discovery context. CRITICAL: only the masked public serializer output
 * is ever returned, so unmasked fields (actualName/fullAddress/pincode/exact
 * geo) can never reach the model — enforced here in addition to the serializer.
 */
async function retrieveMaskedListings(): Promise<PublicListing[]> {
  const page = await listingService.listPublished({ limit: env.ROOMIE_RETRIEVAL_LIMIT });
  return page.items.map(toPublicListing);
}

export interface RoomieAnswer {
  reply: string;
  sessionId: string;
}

export const roomieService = {
  async ask({
    message,
    sessionId,
    ip,
  }: {
    message: string;
    sessionId?: string;
    ip: string;
  }): Promise<RoomieAnswer> {
    if (!llmConfigured()) throw unavailable();

    await enforceRateLimits(ip);

    const sid = sessionId ?? randomUUID();
    const history = await loadHistory(sid);
    const listings = await retrieveMaskedListings();

    const user = buildUserPrompt({ message, listings, history });

    let raw: string;
    try {
      raw = await chat({ system: SYSTEM_PROMPT, user, maxTokens: env.ROOMIE_MAX_OUTPUT_TOKENS });
    } catch (err) {
      // Don't leak provider/internal detail to the client; log for ops (the
      // logger redacts secrets, and the prompt/message are never logged).
      logger.error({ err }, "roomie LLM call failed");
      throw unavailable();
    }

    const reply = sanitizeOutput(raw);
    await saveHistory(sid, history, message, reply);

    return { reply, sessionId: sid };
  },
};
