import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

/**
 * "Roomie" assistant — STUB. It collects NO PII (the message is never logged or
 * persisted and no external call is made) and is rate-limited per IP. It will
 * later proxy to the backend's /v1/roomie endpoint.
 */
const bodySchema = z.object({ message: z.string().min(1).max(1000) }).strict();

const WINDOW_MS = 60_000;
const LIMIT = 20; // messages per IP per minute
const hits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = clientIp(req);
  const now = Date.now();
  const record = hits.get(ip);
  if (!record || record.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    record.count += 1;
    if (record.count > LIMIT) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // Stubbed reply. The message is used transiently and never stored.
  const snippet = parsed.message.replace(/\s+/g, " ").slice(0, 140);
  const reply =
    `I'm Roomie (preview). You asked: "${snippet}". I can help you find PGs by city, ` +
    `budget and sharing type — try the search above. (Stub response; the live assistant is coming soon.)`;

  return NextResponse.json({ reply });
}
