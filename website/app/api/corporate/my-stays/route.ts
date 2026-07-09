import { type NextRequest, type NextResponse } from "next/server";
import { proxyGet } from "../../../../lib/hostBff";

/**
 * The authenticated employee's OWN allocated corporate stays (dates, tier, and —
 * once CONFIRMED — the property name + check-in QR). The backend NEVER returns a
 * negotiated rate / company finance / another employee here (the C0 privacy
 * invariant is structural), so there is no money for this layer to strip.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return proxyGet(req, "/v1/corporate/my-stays");
}
