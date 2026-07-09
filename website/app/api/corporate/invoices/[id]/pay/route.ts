import { NextResponse, type NextRequest } from "next/server";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/**
 * Initiate ONLINE payment of an own-company invoice → returns a server-owned
 * Razorpay order (public keyId only, never a secret; amount is the server-owned
 * outstanding balance). This NEVER marks the invoice paid: settlement comes ONLY
 * from the signature-verified webhook, which the UI then polls for (money rule #2).
 */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return params.then(({ id }) => proxyMutation(req, "POST", `/v1/corporate/invoices/${seg(id)}/pay`, null, 201));
}
