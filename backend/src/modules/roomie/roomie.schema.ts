import { z } from "zod";

/**
 * Request validation for POST /v1/roomie. This is an untrusted, public boundary:
 * we validate strictly (`.strict()` rejects unknown keys), bound the message
 * length BEFORE doing any work, and strip control characters so they can't be
 * smuggled into the prompt.
 */
export const MAX_MESSAGE_CHARS = 1000;

// Match C0 controls (except tab and newline), DEL, and C1 controls. Built from
// an ASCII string so the source file itself carries no literal control bytes.
// eslint-disable-next-line no-control-regex -- intentionally matching control chars
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]", "g");

/**
 * Remove control characters, keeping ordinary whitespace and normalising CRLF.
 * Run AFTER the length check so an oversized payload is rejected rather than
 * silently shrunk.
 */
function stripControlChars(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "").trim();
}

const messageSchema = z
  .string()
  .min(1, "message must not be empty")
  .max(MAX_MESSAGE_CHARS, `message must be at most ${MAX_MESSAGE_CHARS} characters`)
  .transform(stripControlChars)
  // A message that was only control chars/whitespace is empty after stripping.
  .refine((value) => value.length > 0, "message must not be empty");

export const roomieRequestSchema = z
  .object({
    message: messageSchema,
    // Opaque, server-issued session id (UUID). Optional on the first turn.
    sessionId: z.string().uuid().optional(),
  })
  .strict();

export type RoomieRequest = z.infer<typeof roomieRequestSchema>;
