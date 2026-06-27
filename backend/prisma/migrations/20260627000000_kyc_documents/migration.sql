-- AlterTable: self-serve KYC intake stores per-document private S3 object keys
-- (Aadhaar front/back + one supporting ID). docRef becomes nullable now that the
-- pre-self-serve single vendor ref is no longer required.
ALTER TABLE "kyc_records"
  ADD COLUMN "aadhaarFrontKey" TEXT,
  ADD COLUMN "aadhaarBackKey" TEXT,
  ADD COLUMN "supportingDocKey" TEXT,
  ADD COLUMN "supportingDocType" TEXT,
  ALTER COLUMN "docRef" DROP NOT NULL;
