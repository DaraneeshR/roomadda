-- AlterEnum
BEGIN;
CREATE TYPE "BedStatus_new" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED', 'BLOCKED');
ALTER TABLE "public"."beds" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "beds" ALTER COLUMN "status" TYPE "BedStatus_new" USING ("status"::text::"BedStatus_new");
ALTER TYPE "BedStatus" RENAME TO "BedStatus_old";
ALTER TYPE "BedStatus_new" RENAME TO "BedStatus";
DROP TYPE "public"."BedStatus_old";
ALTER TABLE "beds" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';
COMMIT;

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'SPLIT';

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionStatus_new" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');
ALTER TABLE "public"."payment_transactions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payment_transactions" ALTER COLUMN "status" TYPE "TransactionStatus_new" USING ("status"::text::"TransactionStatus_new");
ALTER TYPE "TransactionStatus" RENAME TO "TransactionStatus_old";
ALTER TYPE "TransactionStatus_new" RENAME TO "TransactionStatus";
DROP TYPE "public"."TransactionStatus_old";
ALTER TABLE "payment_transactions" ALTER COLUMN "status" SET DEFAULT 'CREATED';
COMMIT;

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "expiresAt",
ADD COLUMN     "depositPaise" INTEGER NOT NULL,
ADD COLUMN     "holdExpiresAt" TIMESTAMP(3),
ADD COLUMN     "monthlyRentPaise" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "cash_collections" ADD COLUMN     "reconciledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "capturedAt" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'CREATED';
