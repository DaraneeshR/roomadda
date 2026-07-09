import { NextResponse, type NextRequest } from "next/server";
import { allocateEmployeeSchema } from "@roomadda/shared";
import { proxyMutation, seg } from "../../../../../../lib/hostBff";

/** Allocate one of the company's employees to a corporate reservation (ADMIN seat). */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return params.then(({ id }) =>
    proxyMutation(req, "POST", `/v1/corporate/bookings/${seg(id)}/allocate`, allocateEmployeeSchema, 200),
  );
}
