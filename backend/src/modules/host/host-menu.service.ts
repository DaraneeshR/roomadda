import { Prisma, type MealTemplate as MealTemplateModel } from "@prisma/client";
import {
  weeklyMenuSchema,
  type ApplyMealTemplateInput,
  type CreateMealTemplateInput,
  type MealTemplate as MealTemplateDTO,
  type UpsertMealMenuInput,
  type WeeklyMenu,
} from "@roomadda/shared";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { notifyMenuUpdated, menuNotifier } from "../../lib/menu-notify.js";
import { logger } from "../../lib/logger.js";
import { mealMenuInclude, toMealMenuDay, type MealMenuWithHost } from "../menu/menu.serializer.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** UTC midnight of the calendar day containing `d` (matches the @db.Date column). */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function slotData(slot: { text?: string | null; notAvailable?: boolean } | undefined) {
  return { text: slot?.text ?? null, notAvailable: slot?.notAvailable ?? false };
}

function toTemplateDTO(t: MealTemplateModel): MealTemplateDTO {
  // `days` was validated by zod on write; re-validate on read so the DTO is typed.
  const days = weeklyMenuSchema.parse(t.days);
  return { id: t.id, name: t.name, days, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() };
}

export const hostMenuService = {
  /**
   * Write one day's menu (three slots + per-slot "not served today"). The host may
   * only edit TODAY or TOMORROW (planning further ahead is done with templates);
   * a past or far-future date is rejected. Pushes a silent menu-update to the
   * listing's active tenants after the write.
   */
  async writeDay(listingId: string, hostId: string, input: UpsertMealMenuInput, now: Date = new Date()): Promise<MealMenuWithHost> {
    const date = startOfUtcDay(input.date);
    const today = startOfUtcDay(now);
    const tomorrow = new Date(today.getTime() + DAY_MS);
    if (date.getTime() !== today.getTime() && date.getTime() !== tomorrow.getTime()) {
      throw new AppError({
        statusCode: 422,
        code: "MENU_DATE_OUT_OF_RANGE",
        message: "The menu can only be edited for today or tomorrow",
      });
    }
    const data = {
      breakfast: input.breakfast?.text ?? null,
      lunch: input.lunch?.text ?? null,
      dinner: input.dinner?.text ?? null,
      breakfastNotAvailable: input.breakfast?.notAvailable ?? false,
      lunchNotAvailable: input.lunch?.notAvailable ?? false,
      dinnerNotAvailable: input.dinner?.notAvailable ?? false,
      updatedByHostId: hostId,
    };
    const menu = await prisma.mealMenu.upsert({
      where: { listingId_date: { listingId, date } },
      create: { listingId, date, ...data },
      update: data,
      include: mealMenuInclude,
    });
    await notifyMenuUpdated(listingId);
    return menu;
  },

  /** Save (create or replace) a named weekly template for the listing. */
  async saveTemplate(listingId: string, input: CreateMealTemplateInput): Promise<MealTemplateDTO> {
    const days = input.days as unknown as Prisma.InputJsonValue;
    const tpl = await prisma.mealTemplate.upsert({
      where: { listingId_name: { listingId, name: input.name } },
      create: { listingId, name: input.name, days },
      update: { days },
    });
    return toTemplateDTO(tpl);
  },

  async listTemplates(listingId: string): Promise<MealTemplateDTO[]> {
    const rows = await prisma.mealTemplate.findMany({ where: { listingId }, orderBy: { name: "asc" } });
    return rows.map(toTemplateDTO);
  },

  async deleteTemplate(listingId: string, templateId: string): Promise<void> {
    const tpl = await prisma.mealTemplate.findUnique({ where: { id: templateId }, select: { listingId: true } });
    if (!tpl || tpl.listingId !== listingId) {
      throw new AppError({ statusCode: 404, code: "TEMPLATE_NOT_FOUND", message: "Template not found" });
    }
    await prisma.mealTemplate.delete({ where: { id: templateId } });
  },

  /**
   * Apply a saved template to a week: fill 7 consecutive days of menu from Mon→Sun
   * starting at `weekStartDate`. One atomic upsert batch; pushes a silent update.
   */
  async applyTemplate(listingId: string, hostId: string, input: ApplyMealTemplateInput): Promise<number> {
    const tpl = await prisma.mealTemplate.findUnique({ where: { id: input.templateId } });
    if (!tpl || tpl.listingId !== listingId) {
      throw new AppError({ statusCode: 404, code: "TEMPLATE_NOT_FOUND", message: "Template not found" });
    }
    const days: WeeklyMenu = weeklyMenuSchema.parse(tpl.days);
    const start = startOfUtcDay(input.weekStartDate);

    await prisma.$transaction(
      WEEKDAYS.map((weekday, i) => {
        const date = new Date(start.getTime() + i * DAY_MS);
        const day = days[weekday];
        const b = slotData(day.breakfast);
        const l = slotData(day.lunch);
        const d = slotData(day.dinner);
        const data = {
          breakfast: b.text,
          lunch: l.text,
          dinner: d.text,
          breakfastNotAvailable: b.notAvailable,
          lunchNotAvailable: l.notAvailable,
          dinnerNotAvailable: d.notAvailable,
          updatedByHostId: hostId,
        };
        return prisma.mealMenu.upsert({
          where: { listingId_date: { listingId, date } },
          create: { listingId, date, ...data },
          update: data,
        });
      }),
    );
    await notifyMenuUpdated(listingId);
    return WEEKDAYS.length;
  },

  /**
   * 7am sweep: for every meal-offering, live (PUBLISHED, not paused) listing that
   * has NO menu row for today, remind the host to set the day's menu. Best-effort
   * and idempotent per tick. Returns the number of listings reminded. `now` is
   * injectable for tests.
   */
  async remindEmptyMenus(now: Date = new Date()): Promise<number> {
    const today = startOfUtcDay(now);
    const listings = await prisma.pgListing.findMany({
      where: {
        mealsOffered: true,
        status: "PUBLISHED",
        paused: false,
        mealMenus: { none: { date: today } },
      },
      select: { id: true, hostId: true },
    });
    for (const l of listings) {
      try {
        await menuNotifier.emptyMenuReminder({ listingId: l.id, hostId: l.hostId });
      } catch (err) {
        logger.error({ err, listingId: l.id }, "empty-menu reminder failed");
      }
    }
    return listings.length;
  },

  toMealMenuDay,
};
