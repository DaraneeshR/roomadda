import { NextResponse, type NextRequest } from "next/server";
import {
  kycMimeSchema,
  kycSlotSchema,
  kycSupportingDocTypeSchema,
  type KycUploadUrlResponse,
} from "@roomadda/shared";
import { bearerFrom, callBackend, relayError } from "../../../../lib/backend";
import { env } from "../../../../lib/env";

/**
 * Upload one KYC document to the PRIVATE bucket via the backend's presigned-PUT
 * pattern — WITHOUT the browser ever touching the bucket:
 *
 *   1. ask the backend for a presigned PUT URL + object key (`/v1/kyc/upload-url`)
 *   2. stream the bytes to that URL from this server
 *
 * Keeping the PUT server-side means the strict CSP (`connect-src 'self'`) stays
 * intact and the bucket host is never exposed to the client. Only the opaque
 * object `key` comes back; the raw file and the presigned URL stay server-side.
 */
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per document
/** SSE header the backend pins into the presigned signature (see storage.ts). */
const SSE_HEADER = "x-amz-server-side-encryption";
const SSE_ALGORITHM = "AES256";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const bearer = bearerFrom(req);
  if (!bearer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const file = form.get("file");
  const slotParse = kycSlotSchema.safeParse(form.get("slot"));
  if (!(file instanceof Blob) || !slotParse.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const slot = slotParse.data;

  const mimeParse = kycMimeSchema.safeParse(file.type);
  if (!mimeParse.success) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 415 });
  }
  const contentType = mimeParse.data;

  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  // The supporting slot additionally carries which document it is. Validate now
  // so a bad value fails fast (it is only used at the submit step).
  if (slot === "supporting" && !kycSupportingDocTypeSchema.safeParse(form.get("docType")).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // 1) Presigned URL from the backend (TENANT-only, enforced server-side there).
  const presign = await callBackend("/v1/kyc/upload-url", {
    method: "POST",
    json: { slot, contentType },
    bearer,
    from: req,
  });
  if (presign.status !== 201) return relayError(presign);
  const { key, uploadUrl } = presign.body as KycUploadUrlResponse;

  // 2) Stream the bytes to the private bucket. ContentType + SSE must match the
  // pinned signature exactly or the bucket rejects the PUT.
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType, [SSE_HEADER]: SSE_ALGORITHM },
    body: file,
  }).catch(() => null);

  // In local dev the stub bucket URL does not resolve; surface a clear message
  // rather than a generic 500 so the flow is diagnosable without real S3.
  if (!put || !put.ok) {
    const devHint = env.BACKEND_API_URL.includes("localhost")
      ? " (local dev uses a stub bucket that does not accept real uploads)"
      : "";
    return NextResponse.json(
      { error: "upload_failed", message: `Could not store the document.${devHint}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ key, slot }, { status: 201 });
}
