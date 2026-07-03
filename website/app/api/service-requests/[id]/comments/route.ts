import { NextResponse, type NextRequest } from "next/server";
import { serviceRequestCommentInputSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../../../lib/backend";

/** Add a follow-up comment to the caller's own ticket (tenants never delete). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = serviceRequestCommentInputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await params;
  const result = await callBackend(`/v1/service-requests/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    json: body,
    bearer,
    from: req,
  });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}
