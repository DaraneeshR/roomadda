import { type NextRequest, type NextResponse } from "next/server";
import { createMealTemplateSchema } from "@roomadda/shared";
import { proxyGet, proxyMutation, seg } from "../../../../../../lib/hostBff";

/** List the listing's saved weekly meal templates. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyGet(req, `/v1/host/listings/${seg(id)}/menu-templates`);
}

/** Save (create/replace) a named weekly template. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return proxyMutation(req, "POST", `/v1/host/listings/${seg(id)}/menu-templates`, createMealTemplateSchema, 201);
}
