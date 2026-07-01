import { Prisma } from "@prisma/client";
import type { MealMenuDay } from "@roomadda/shared";

/**
 * Meal-menu serializer. A day with a row maps its slots (dish text + the host's
 * "not served today" flag) and the last-updated transparency fields; a day with
 * NO row is the "not updated yet" empty day. The mobile renders "Not available
 * today" for any slot with no dish (null text) or an explicit notAvailable flag.
 */
export const mealMenuInclude = {
  updatedByHost: { select: { fullName: true } },
} satisfies Prisma.MealMenuInclude;

export type MealMenuWithHost = Prisma.MealMenuGetPayload<{ include: typeof mealMenuInclude }>;

/** The "no menu for this day" shape — every slot empty, flagged not-updated. */
export function emptyMenuDay(date: Date): MealMenuDay {
  return {
    date: date.toISOString(),
    breakfast: { text: null, notAvailable: false },
    lunch: { text: null, notAvailable: false },
    dinner: { text: null, notAvailable: false },
    updatedByHostName: null,
    updatedAt: null,
    notUpdated: true,
  };
}

export function toMealMenuDay(menu: MealMenuWithHost): MealMenuDay {
  return {
    date: menu.date.toISOString(),
    breakfast: { text: menu.breakfast, notAvailable: menu.breakfastNotAvailable },
    lunch: { text: menu.lunch, notAvailable: menu.lunchNotAvailable },
    dinner: { text: menu.dinner, notAvailable: menu.dinnerNotAvailable },
    updatedByHostName: menu.updatedByHost?.fullName ?? null,
    updatedAt: menu.updatedAt.toISOString(),
    notUpdated: false,
  };
}
