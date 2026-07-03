import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, clientIp } from "../../../../../lib/backend";
import { env } from "../../../../../lib/env";

/**
 * Stream the confirmed-booking PDF receipt back to the browser. The backend
 * only serves it to the owning TENANT once the booking is CONFIRMED. We can't
 * use `callBackend` here (it JSON-parses the body); the PDF is binary, so we
 * pipe the bytes through untouched with the download headers.
 *
 * The browser fetches this via the in-memory access token (so a plain
 * <a download> won't work — the client fetches the blob and triggers the save),
 * which is why the bearer is forwarded rather than relying on a cookie.
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

  const upstream = await fetch(`${env.BACKEND_API_URL}/v1/bookings/${encodeURIComponent(id)}/receipt`, {
    method: "GET",
    headers,
    cache: "no-store",
  }).catch(() => null);

  if (!upstream || !upstream.ok) {
    return NextResponse.json(
      { error: "receipt_unavailable", message: "The receipt is available once your booking is confirmed." },
      { status: upstream?.status && upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  const pdf = await upstream.arrayBuffer();
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="roomadda-receipt-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
