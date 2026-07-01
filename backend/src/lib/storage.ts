import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isProduction } from "../config/env.js";
import { AppError } from "./errors.js";

/**
 * Object storage behind an interface so it is stubbable in tests/dev (no real
 * bucket) and swappable per environment — the same Live/Stub pattern as
 * razorpay.ts and sms.ts.
 *
 * Two buckets, two privacy postures:
 *  - PRIVATE (KYC, service-request, chat, inspection photos): encrypted at rest
 *    (SSE AES-256). The client PUTs bytes via a short-lived presigned URL; only
 *    the object KEY is ever stored, and viewing goes through a presigned GET.
 *  - PUBLIC (listing photos): served to anyone browsing, so they live in a
 *    public-read bucket and the STABLE public URL is what we persist + return.
 * See /CLAUDE.md: secrets/PII never logged; private access stays server-mediated.
 */
export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
}

/**
 * A public-bucket presign: like {@link PresignedUpload} plus the stable, publicly
 * readable `publicUrl` the client attaches + we serve (listing photos are public,
 * unlike the private KYC/service/inspection objects which expose only a key).
 */
export interface PublicPresignedUpload extends PresignedUpload {
  publicUrl: string;
}

export interface ObjectStorage {
  /** A presigned PUT URL the client uses to upload one object to the private bucket. */
  presignUpload(params: { key: string; contentType: string }): Promise<PresignedUpload>;
  /** A short-lived presigned GET URL so an authorized client can view one private object. */
  presignDownload(key: string): Promise<string>;
  /**
   * A presigned PUT to the PUBLIC bucket (listing photos). Returns the stable
   * `publicUrl` to persist + serve — the object is public-read by bucket policy /
   * CDN, so unlike the private flow there is no per-view presigned GET.
   */
  presignPublicUpload(params: { key: string; contentType: string }): Promise<PublicPresignedUpload>;
}

/** Server-side encryption header the presigned PUT pins (AES-256, S3-managed keys). */
const SSE_ALGORITHM = "AES256";

class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  /** Public-read bucket for listing photos (served on public listings). */
  private readonly publicBucket: string;
  /** Optional CDN / custom-domain base for public URLs; falls back to the S3 host. */
  private readonly publicBaseUrl: string | undefined;
  private readonly region: string;
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
    if (!env.LISTING_PHOTOS_S3_BUCKET) {
      throw new AppError({
        statusCode: 500,
        code: "STORAGE_NOT_CONFIGURED",
        message: "LISTING_PHOTOS_S3_BUCKET must be set for S3 storage",
        expose: false,
      });
    }
    this.bucket = env.KYC_S3_BUCKET;
    this.publicBucket = env.LISTING_PHOTOS_S3_BUCKET;
    this.publicBaseUrl = env.LISTING_PHOTOS_PUBLIC_BASE_URL;
    this.region = env.AWS_REGION;
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

  async presignDownload(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: this.ttl });
  }

  async presignPublicUpload({ key, contentType }: { key: string; contentType: string }): Promise<PublicPresignedUpload> {
    // Listing photos are public marketing images (no PII), so the object is
    // public-read by bucket policy — no SSE. Pin ContentType so the upload cannot
    // deviate from what we authorised; the returned publicUrl is stored + served.
    const command = new PutObjectCommand({
      Bucket: this.publicBucket,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.ttl });
    return { uploadUrl, key, publicUrl: this.publicUrlFor(key), expiresInSeconds: this.ttl };
  }

  /** Stable public URL: the configured CDN/base if set, else the S3 virtual host. */
  private publicUrlFor(key: string): string {
    if (this.publicBaseUrl) return `${this.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
    return `https://${this.publicBucket}.s3.${this.region}.amazonaws.com/${key}`;
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

  presignDownload(key: string): Promise<string> {
    return Promise.resolve(`https://kyc-uploads.stub.local/${key}?stub=1&download=1`);
  }

  presignPublicUpload({ key }: { key: string; contentType: string }): Promise<PublicPresignedUpload> {
    const ttl = env.KYC_UPLOAD_URL_TTL_SECONDS;
    return Promise.resolve({
      uploadUrl: `https://listing-photos.stub.local/${key}?stub=1`,
      key,
      // A stable, valid public URL so the attach step (createPhotoSchema.url) passes.
      publicUrl: `https://listing-photos.stub.local/${key}`,
      expiresInSeconds: ttl,
    });
  }
}

export const objectStorage: ObjectStorage = isProduction ? new S3ObjectStorage() : new StubObjectStorage();
