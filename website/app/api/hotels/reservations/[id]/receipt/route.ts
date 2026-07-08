import { NextResponse, type NextRequest } from "next/server";
import { bearerFrom, clientIp } from "../../../../../../lib/backend";
import { env } from "../../../../../../lib/env";

/**
 * Stream the confirmed-reservation PDF receipt back to the browser. The backend
 * only serves it to the owning guest once the reservation is CONFIRMED. We can't
 * use `callBackend` here (it JSON-parses the body); the PDF is binary, so we pipe
 * the bytes through untouched with the download headers.
 *
 * The browser fetches this with its in-memory access token (a plain <a download>
 * can't attach the bearer), so the token is forwarded rather than relying on a
 * cookie — exactly like the PG booking receipt.
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

  const upstream = await fetch(`${env.BACKEND_API_URL}/v1/hotels/reservations/${encodeURIComponent(id)}/receipt`, {
    method: "GET",
    headers,
    cache: "no-store",
  }).catch(() => null);

  if (!upstream || !upstream.ok) {
    return NextResponse.json(
      { error: "receipt_unavailable", message: "The receipt is available once your reservation is confirmed." },
      { status: upstream?.status && upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  const pdf = await upstream.arrayBuffer();
  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="roomadda-hotel-receipt-${id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
