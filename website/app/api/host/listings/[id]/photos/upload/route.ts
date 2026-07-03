import { NextResponse, type NextRequest } from "next/server";
import {
  createPhotoSchema,
  listingPhotoUploadUrlSchema,
  type ListingPhotoUploadUrlResponse,
} from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../../../../../lib/backend";
import { env } from "../../../../../../../lib/env";
import { seg } from "../../../../../../../lib/hostBff";

/**
 * Upload one listing photo to the PUBLIC bucket via the backend's presigned-PUT
 * pattern — the browser never touches the bucket (the strict CSP stays
 * `connect-src 'self'`). Three server-side hops:
 *
 *   1. ask the backend for a presigned PUT URL + stable publicUrl (owner-404)
 *   2. stream the bytes to that URL from this server
 *   3. attach the publicUrl to the listing (POST /v1/listings/:id/photos)
 *
 * Listing photos are public, so unlike KYC we get a servable `publicUrl` back and
 * attach it. Mirrors the KYC upload route + the on-device host photo flow.
 */
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per photo

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const ctParse = listingPhotoUploadUrlSchema.shape.contentType.safeParse(file.type);
  if (!ctParse.success) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }
  const contentType = ctParse.data;

  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  // Photo placement is optional; validate only if the client sent it.
  const isPrimary = form.get("isPrimary") === "true";
  const sortOrderRaw = form.get("sortOrder");
  const sortOrder = typeof sortOrderRaw === "string" && sortOrderRaw !== "" ? Number(sortOrderRaw) : 0;

  // 1) Presigned URL from the backend (HOST/owner — a foreign listing is 404).
  const presign = await callBackend(`/v1/listings/${seg(id)}/photos/upload-url`, {
    method: "POST",
    json: { contentType },
    bearer,
    from: req,
  });
  if (presign.status !== 201) return relayError(presign);
  const { uploadUrl, publicUrl } = presign.body as ListingPhotoUploadUrlResponse;

  // 2) Stream the bytes to the public bucket. ContentType must match the pinned
  //    signature exactly or the bucket rejects the PUT.
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  }).catch(() => null);

  if (!put || !put.ok) {
    const devHint = env.BACKEND_API_URL.includes("localhost")
      ? " (local dev uses a stub bucket that does not accept real uploads)"
      : "";
    return NextResponse.json(
      { error: "upload_failed", message: `Could not store the photo.${devHint}` },
      { status: 502 },
    );
  }

  // 3) Attach the now-uploaded public URL to the listing.
  const attachBody = createPhotoSchema.parse({ url: publicUrl, isPrimary, sortOrder });
  const attach = await callBackend(`/v1/listings/${seg(id)}/photos`, {
    method: "POST",
    json: attachBody,
    bearer,
    from: req,
  });
  if (attach.status !== 201) return relayError(attach);
  return NextResponse.json(attach.body, { status: 201 });
}
