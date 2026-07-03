import { NextResponse, type NextRequest } from "next/server";
import { wishlistParamSchema } from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../../lib/backend";

/**
 * Save / unsave a listing — idempotent, always the caller's OWN wishlist, written
 * to the shared account (same rows as the app). The heart on listing cards calls
 * these. The backend validates the listing id and that it is PUBLISHED.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { listingId } = await params;
  if (!wishlistParamSchema.safeParse({ listingId }).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await callBackend(`/v1/wishlist/${encodeURIComponent(listingId)}`, {
    method: "POST",
    bearer,
    from: req,
  });
  if (result.status !== 201) return relayError(result);
  return NextResponse.json(result.body, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ listingId: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { listingId } = await params;
  if (!wishlistParamSchema.safeParse({ listingId }).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await callBackend(`/v1/wishlist/${encodeURIComponent(listingId)}`, {
    method: "DELETE",
    bearer,
    from: req,
  });
  // Backend returns 204 No Content on success.
  if (result.status !== 204 && result.status !== 200) return relayError(result);
  return new NextResponse(null, { status: 204 });
}
