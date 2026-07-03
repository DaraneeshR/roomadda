import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, callBackend, relayError } from "../../../../lib/backend";

/**
 * Read one of the caller's own rent invoices. The "confirming…" rent screen
 * polls THIS to observe the webhook-driven DUE → PAID transition (RENT IS MONEY;
 * only the verified webhook marks it PAID — see /CLAUDE.md domain rule #2). A
 * foreign id is a 404 from the backend (never 403).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const result = await callBackend(`/v1/rent/${encodeURIComponent(id)}`, { method: "GET", bearer, from: req });
  if (result.status !== 200) return relayError(result);
  return NextResponse.json(result.body);
}
