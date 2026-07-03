import { type NextRequest, type NextResponse } from "next/server";
import { applyMealTemplateSchema } from "@roomadda/shared";
import { proxyMutation, seg } from "../../../../../../../lib/hostBff";

/** Apply a saved template to a week (fills 7 days Mon→Sun from weekStartDate). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/host/listings/${seg(id)}/menu-templates/apply`, applyMealTemplateSchema);
}
