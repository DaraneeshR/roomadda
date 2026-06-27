import { randomUUID } from "node:crypto";
import type {
  KycMeResponse,
  KycMime,
  KycSlot,
  KycSubmitInput,
  KycSubmitResponse,
  KycUploadUrlInput,
  KycUploadUrlResponse,
} from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { objectStorage } from "../../lib/storage.js";

/** File extension per allowed MIME (the request schema constrains the set). */
const EXT_FOR_MIME: Record<KycMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

/** Per-user private prefix; every KYC object lives under it so keys can't be forged. */
export function kycPrefix(userId: string): string {
  return `kyc/${userId}/`;
}

/** Build a namespaced, unguessable object key for one document slot. */
export function kycObjectKey(userId: string, slot: KycSlot, contentType: KycMime): string {
  return `${kycPrefix(userId)}${slot}-${randomUUID()}.${EXT_FOR_MIME[contentType]}`;
}

export const kycService = {
  /** Issue a presigned PUT URL for one document slot (TENANT). */
  async createUploadUrl(userId: string, input: KycUploadUrlInput): Promise<KycUploadUrlResponse> {
    const key = kycObjectKey(userId, input.slot, input.contentType);
    return objectStorage.presignUpload({ key, contentType: input.contentType });
  },

  /**
   * Record the three uploaded documents as a PENDING KycRecord (TENANT).
   * Re-submitting after a rejection clears the prior decision and returns the
   * record to PENDING — the re-upload path. NEVER flips to VERIFIED here; that
   * is admin-only (see /CLAUDE.md: default-deny, server-owned status).
   */
  async submit(userId: string, input: KycSubmitInput): Promise<KycSubmitResponse> {
    const prefix = kycPrefix(userId);
    const docs = [input.aadhaarFront, input.aadhaarBack, input.supporting];
    // Ownership: every key MUST be under the caller's own prefix, so a tenant
    // cannot attach another user's object or an arbitrary bucket key.
    if (docs.some((d) => !d.key.startsWith(prefix))) {
      throw new AppError({
        statusCode: 422,
        code: "INVALID_KYC_KEY",
        message: "Document keys must come from your own upload URLs",
      });
    }

    const data = {
      status: "PENDING" as const,
      docType: "AADHAAR" as const,
      aadhaarFrontKey: input.aadhaarFront.key,
      aadhaarBackKey: input.aadhaarBack.key,
      supportingDocKey: input.supporting.key,
      supportingDocType: input.supporting.docType,
      // Clear any prior admin decision so a re-upload returns to PENDING review.
      verifiedAt: null,
      rejectedAt: null,
      rejectReason: null,
    };

    const record = await prisma.kycRecord.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return { status: "PENDING", submittedAt: record.updatedAt.toISOString() };
  },

  /** The caller's own KYC status + rejection reason (NOT_SUBMITTED when absent). */
  async getMine(userId: string): Promise<KycMeResponse> {
    const rec = await prisma.kycRecord.findUnique({ where: { userId } });
    if (!rec) {
      return { status: "NOT_SUBMITTED", rejectReason: null, submittedAt: null, reviewedAt: null };
    }
    return {
      status: rec.status,
      rejectReason: rec.rejectReason ?? null,
      submittedAt: rec.createdAt.toISOString(),
      reviewedAt: (rec.verifiedAt ?? rec.rejectedAt)?.toISOString() ?? null,
    };
  },
};
