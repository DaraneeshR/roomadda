import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isProduction } from "../config/env.js";
import { AppError } from "./errors.js";

/**
 * Private object storage for KYC documents, behind an interface so it is
 * stubbable in tests/dev (no real bucket) and swappable per environment — the
 * same Live/Stub pattern as razorpay.ts and sms.ts.
 *
 * Documents go to a PRIVATE bucket encrypted at rest (SSE AES-256). The client
 * uploads bytes straight to S3 via a short-lived presigned PUT URL; only the
 * object KEY is ever returned to us and stored (never the file, never a public
 * URL). See /CLAUDE.md: secrets/PII never logged; access stays server-mediated.
 */
export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
}

export interface ObjectStorage {
  /** A presigned PUT URL the client uses to upload one object to the private bucket. */
  presignUpload(params: { key: string; contentType: string }): Promise<PresignedUpload>;
}

/** Server-side encryption header the presigned PUT pins (AES-256, S3-managed keys). */
const SSE_ALGORITHM = "AES256";

class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;

  constructor() {
    if (!env.KYC_S3_BUCKET || !env.AWS_REGION) {
      throw new AppError({
        statusCode: 500,
        code: "STORAGE_NOT_CONFIGURED",
        message: "KYC_S3_BUCKET and AWS_REGION must be set for S3 storage",
        expose: false,
      });
    }
    this.bucket = env.KYC_S3_BUCKET;
    this.ttl = env.KYC_UPLOAD_URL_TTL_SECONDS;
    // Credentials come from the standard AWS provider chain (env / role).
    this.client = new S3Client({ region: env.AWS_REGION });
  }

  async presignUpload({ key, contentType }: { key: string; contentType: string }): Promise<PresignedUpload> {
    // Pin ContentType + SSE into the signature so the upload CANNOT deviate from
    // what we authorised (correct type, encrypted at rest, private by bucket policy).
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: SSE_ALGORITHM,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.ttl });
    return { uploadUrl, key, expiresInSeconds: this.ttl };
  }
}

/**
 * Dev/test storage: returns a deterministic, non-functional upload URL so the
 * flow (request URL -> store key -> submit) is exercised without a real bucket.
 * Nothing is uploaded or persisted to disk.
 */
class StubObjectStorage implements ObjectStorage {
  presignUpload({ key }: { key: string; contentType: string }): Promise<PresignedUpload> {
    const ttl = env.KYC_UPLOAD_URL_TTL_SECONDS;
    return Promise.resolve({
      uploadUrl: `https://kyc-uploads.stub.local/${key}?stub=1`,
      key,
      expiresInSeconds: ttl,
    });
  }
}

export const objectStorage: ObjectStorage = isProduction ? new S3ObjectStorage() : new StubObjectStorage();
