import type { TrustedContact } from "@prisma/client";
import type { TrustedContact as TrustedContactDTO } from "@roomadda/shared";

export function toTrustedContact(c: TrustedContact): TrustedContactDTO {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    createdAt: c.createdAt.toISOString(),
  };
}
