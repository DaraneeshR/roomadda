import type { AdSlotType } from "@prisma/client";

/** Days covered by a slot type. */
export function adDurationDays(slotType: AdSlotType): number {
  return slotType === "WEEK" ? 7 : 1;
}

/** endDate = startDate + duration. */
export function computeAdEndDate(startDate: Date, slotType: AdSlotType): Date {
  const end = new Date(startDate.getTime());
  end.setUTCDate(end.getUTCDate() + adDurationDays(slotType));
  return end;
}

export interface FeaturableAd {
  status: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Pure rule (see /CLAUDE.md & task): an ad is featured ONLY when it is APPROVED,
 * the current time is within [startDate, endDate], AND the listing is PUBLISHED.
 */
export function isAdFeatured(ad: FeaturableAd, listingStatus: string, now: Date): boolean {
  return (
    ad.status === "APPROVED" &&
    listingStatus === "PUBLISHED" &&
    ad.startDate.getTime() <= now.getTime() &&
    now.getTime() <= ad.endDate.getTime()
  );
}
