-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "LandingPageKind" AS ENUM ('CITY', 'AREA', 'INTENT', 'LANDMARK');

-- CreateEnum
CREATE TYPE "BroadcastChannel" AS ENUM ('PUSH', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "BroadcastAudience" AS ENUM ('ALL_USERS', 'TENANTS', 'HOSTS', 'AGENTS', 'CITY', 'BEHAVIOUR');

-- CreateEnum
CREATE TYPE "AdminBroadcastStatus" AS ENUM ('SCHEDULED', 'SENT', 'CANCELLED');

-- AlterTable
ALTER TABLE "trust_tags" ADD COLUMN     "startsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "statusUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "host_flags" (
    "id" UUID NOT NULL,
    "hostId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "serviceRequestId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "excerpt" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "quote" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_pages" (
    "id" UUID NOT NULL,
    "kind" "LandingPageKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "bodyCopy" TEXT NOT NULL DEFAULT '',
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "ogImageUrl" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_features" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homepage_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_broadcasts" (
    "id" UUID NOT NULL,
    "channel" "BroadcastChannel" NOT NULL,
    "audience" "BroadcastAudience" NOT NULL,
    "audienceValue" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deepLink" TEXT,
    "status" "AdminBroadcastStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "host_flags_hostId_createdAt_idx" ON "host_flags"("hostId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_published_publishedAt_idx" ON "blog_posts"("published", "publishedAt");

-- CreateIndex
CREATE INDEX "faqs_published_sortOrder_idx" ON "faqs"("published", "sortOrder");

-- CreateIndex
CREATE INDEX "testimonials_published_sortOrder_idx" ON "testimonials"("published", "sortOrder");

-- CreateIndex
CREATE INDEX "landing_pages_published_idx" ON "landing_pages"("published");

-- CreateIndex
CREATE UNIQUE INDEX "landing_pages_kind_slug_key" ON "landing_pages"("kind", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_features_listingId_key" ON "homepage_features"("listingId");

-- CreateIndex
CREATE INDEX "homepage_features_position_idx" ON "homepage_features"("position");

-- CreateIndex
CREATE INDEX "admin_broadcasts_status_scheduledAt_idx" ON "admin_broadcasts"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "admin_broadcasts_createdAt_idx" ON "admin_broadcasts"("createdAt");

