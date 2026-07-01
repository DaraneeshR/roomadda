-- CreateTable
CREATE TABLE "meal_menus" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "breakfast" TEXT,
    "lunch" TEXT,
    "dinner" TEXT,
    "breakfastNotAvailable" BOOLEAN NOT NULL DEFAULT false,
    "lunchNotAvailable" BOOLEAN NOT NULL DEFAULT false,
    "dinnerNotAvailable" BOOLEAN NOT NULL DEFAULT false,
    "updatedByHostId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_menus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_menus_listingId_date_idx" ON "meal_menus"("listingId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meal_menus_listingId_date_key" ON "meal_menus"("listingId", "date");

-- AddForeignKey
ALTER TABLE "meal_menus" ADD CONSTRAINT "meal_menus_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "pg_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_menus" ADD CONSTRAINT "meal_menus_updatedByHostId_fkey" FOREIGN KEY ("updatedByHostId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
