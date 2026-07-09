import { NextResponse, type NextRequest } from "next/server";
import { respondQuotationSchema } from "@roomadda/shared";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/** Respond to a SENT quotation: ACCEPT / REJECT / REQUEST_CHANGES. Company-scoped
 *  by the backend. Accepting unlocks the admin's booking conversion. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return params.then(({ id }) =>
    proxyMutation(req, "POST", `/v1/corporate/quotations/${seg(id)}/respond`, respondQuotationSchema, 200),
  );
}
