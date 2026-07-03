import { type NextRequest, type NextResponse } from "next/server";
import { proxyMutation, seg } from "../../../../../../../lib/hostBff";

/** Delete a saved weekly meal template. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; templateId: string }> },
): Promise<NextResponse> {
  const { id, templateId } = await params;
  return proxyMutation(req, "DELETE", `/v1/host/listings/${seg(id)}/menu-templates/${seg(templateId)}`, null, 204);
}
