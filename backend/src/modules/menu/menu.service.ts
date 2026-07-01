import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { listingService } from "../listing/listing.service.js";
import { mealMenuInclude, type MealMenuWithHost } from "./menu.serializer.js";
import type { UpsertMealMenuInput } from "./menu.schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of the calendar day containing `d` (matches the @db.Date column). */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const listingNotFound = () =>
  new AppError({ statusCode: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" });

export const mealMenuService = {
  /**
   * The menu for `anchor` (a calendar day, default today) and the following day,
   * returned as `[day0, day1]` plus whichever rows exist. The route fills missing
   * days with the "not updated yet" empty shape. 404 if the listing is unknown.
   * (Clients should pass their LOCAL date as `?date=` so "today" is correct in
   * India regardless of the server's timezone.)
   */
  async getTwoDayMenu(
    listingId: string,
    anchor: Date,
  ): Promise<{ dates: [Date, Date]; rows: MealMenuWithHost[] }> {
    const ownership = await listingService.getOwnership(listingId);
    if (!ownership) throw listingNotFound();

    const day0 = startOfUtcDay(anchor);
    const day1 = new Date(day0.getTime() + DAY_MS);
    const rows = await prisma.mealMenu.findMany({
      where: { listingId, date: { in: [day0, day1] } },
      include: mealMenuInclude,
    });
    return { dates: [day0, day1], rows };
  },

  /**
   * Minimal host upsert of one day's menu (full host-update UI lands in the host
   * phase). Keyed on (listingId, date): a day is created or fully replaced, and
   * `updatedByHost` records who edited it. Ownership is enforced in the route.
   */
  async upsertMenu(
    listingId: string,
    hostId: string,
    input: UpsertMealMenuInput,
  ): Promise<MealMenuWithHost> {
    const date = startOfUtcDay(input.date);
    const data = {
      breakfast: input.breakfast?.text ?? null,
      lunch: input.lunch?.text ?? null,
      dinner: input.dinner?.text ?? null,
      breakfastNotAvailable: input.breakfast?.notAvailable ?? false,
      lunchNotAvailable: input.lunch?.notAvailable ?? false,
      dinnerNotAvailable: input.dinner?.notAvailable ?? false,
      updatedByHostId: hostId,
    };
    return prisma.mealMenu.upsert({
      where: { listingId_date: { listingId, date } },
      create: { listingId, date, ...data },
      update: data,
      include: mealMenuInclude,
    });
  },
};
