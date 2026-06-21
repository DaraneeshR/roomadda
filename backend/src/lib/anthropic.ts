import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";

/**
 * The ONLY module that talks to the LLM provider. Roomie's prompt construction,
 * retrieval, and rate limiting live in the roomie module; this file is the thin
 * provider boundary so swapping models/providers is an env (or single-file)
 * change, never a change across the codebase. The API key comes from env and is
 * never logged.
 */
let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  // Lazily constructed so a missing key disables the feature instead of throwing
  // at import time.
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/** True when an API key is configured. The route returns 503 when it isn't. */
export function llmConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export interface ChatParams {
  /** Trusted instructions. Built server-side; never contains user/listing text. */
  system: string;
  /** The single user turn: delimited masked data + the (untrusted) question. */
  user: string;
  /** Hard output cap (tokens). */
  maxTokens: number;
}

/**
 * One-shot, single-turn completion. No tools, no streaming — Roomie is a short
 * public helper and the output is bounded by `maxTokens` (well under the SDK's
 * non-streaming timeout). Thinking is left off and the system prompt asks for a
 * direct answer, keeping latency low for the chat widget. Throws on transport/
 * API failure; the caller maps that to a sanitized 503.
 */
export async function chat({ system, user, maxTokens }: ChatParams): Promise<string> {
  const c = getClient();
  if (!c) throw new Error("LLM not configured");

  const response = await c.messages.create({
    model: env.ROOMIE_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
