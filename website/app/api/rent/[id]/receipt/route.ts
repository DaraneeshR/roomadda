import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, clientIp } from "../../../../../lib/backend";
import { env } from "../../../../../lib/env";

/**
 * Stream the PAID-rent PDF receipt to the browser. Binary, so it bypasses
 * `callBackend` (which JSON-parses) and pipes the bytes through with download
 * headers. The backend only serves it to the owning tenant once the invoice is
 * PAID; the client fetches it with the in-memory bearer and triggers the save.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const headers: Record<string, string> = { Accept: "application/pdf", Authorization: `Bearer ${bearer}` };
  const ip = clientIp(req);
  if (ip) headers["x-forwarded-for"] = ip;

  const upstream = await fetch(`${env.BACKEND_API_URL}/v1/rent/${encodeURIComponent(id)}/receipt`, {
    method: "GET",
    headers,
    cache: "no-store",
  }).catch(() => null);

  if (!upstream || !upstream.ok) {
    return NextResponse.json(
      { error: "receipt_unavailable", message: "The receipt is available once the rent is paid." },
      { status: upstream?.status && upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  const pdf = await upstream.arrayBuffer();
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="roomadda-rent-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
