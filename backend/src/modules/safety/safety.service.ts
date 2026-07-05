import { Prisma, type TrustedContact } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { smsSender } from "../../lib/sms.js";
import { safetyNotifier } from "../../lib/safety-notify.js";
import type { CreateTrustedContactInput, SosInput } from "./safety.schema.js";

/** A user may keep at most this many trusted contacts. */
const MAX_TRUSTED_CONTACTS = 3;

export interface SosResult {
  contactsNotified: number;
  adminAlerted: boolean;
}

const contactNotFound = () =>
  new AppError({ statusCode: 404, code: "CONTACT_NOT_FOUND", message: "Trusted contact not found" });

export const safetyService = {
  maxContacts: MAX_TRUSTED_CONTACTS,

  async listContacts(userId: string): Promise<TrustedContact[]> {
    return prisma.trustedContact.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  },

  async addContact(userId: string, input: CreateTrustedContactInput): Promise<TrustedContact> {
    const count = await prisma.trustedContact.count({ where: { userId } });
    if (count >= MAX_TRUSTED_CONTACTS) {
      throw new AppError({
        statusCode: 409,
        code: "CONTACTS_LIMIT_REACHED",
        message: `You can keep at most ${MAX_TRUSTED_CONTACTS} trusted contacts`,
      });
    }
    try {
      return await prisma.trustedContact.create({ data: { userId, name: input.name, phone: input.phone } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError({ statusCode: 409, code: "CONTACT_EXISTS", message: "This number is already a trusted contact" });
      }
      throw err;
    }
  },

  async removeContact(userId: string, id: string): Promise<void> {
    const contact = await prisma.trustedContact.findUnique({ where: { id }, select: { userId: true } });
    if (!contact || contact.userId !== userId) throw contactNotFound();
    await prisma.trustedContact.delete({ where: { id } });
  },

  /**
   * Trigger SOS. SMSes EVERY trusted contact (best-effort per contact) with the
   * user's location, and ALWAYS alerts the admin/ops channel — even with zero
   * contacts or no GPS fix, so it still helps on poor connectivity / denied
   * location. The SMS path (not just push) is the reliable channel.
   */
  async triggerSos(userId: string, input: SosInput): Promise<SosResult> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, phone: true } });
    if (!user) throw new AppError({ statusCode: 401, code: "UNAUTHENTICATED", message: "User not found" });

    const contacts = await prisma.trustedContact.findMany({ where: { userId } });
    const hasLocation = input.lat != null && input.lng != null;
    const locationText = hasLocation
      ? `https://maps.google.com/?q=${input.lat},${input.lng}`
      : "Location unavailable";

    let contactsNotified = 0;
    for (const contact of contacts) {
      try {
        await smsSender.sendSos({
          toPhone: contact.phone,
          contactName: contact.name,
          userName: user.fullName,
          locationText,
        });
        contactsNotified += 1;
      } catch (err) {
        // One contact failing must not stop the others or the admin alert.
        logger.error({ err, contactId: contact.id }, "SOS SMS to contact failed");
      }
    }

    // Admin alert ALWAYS fires (best-effort) — the safety net of last resort.
    await safetyNotifier
      .sosToAdmin({
        userId,
        userName: user.fullName,
        userPhone: user.phone!, // the SOS user is a phone-OTP account
        locationText,
        hasLocation,
        contactsNotified,
      })
      .catch((err) => logger.error({ err, userId }, "SOS admin alert failed"));

    await writeAudit({ actorId: userId, action: "sos.triggered", metadata: { contactsNotified, hasLocation } });
    return { contactsNotified, adminAlerted: true };
  },
};
