import type { User } from "@prisma/client";
import type { SelfUser } from "@roomadda/shared";

/**
 * Self-view of a user (returned to the user themselves / admins). This is NOT
 * the public listing-owner view; listing masking is handled separately. The
 * `SelfUser` DTO shape is defined once in `@roomadda/shared`.
 */
export function serializeUserSelf(user: User): SelfUser {
  return {
    id: user.id,
    role: user.role,
    phone: user.phone,
    fullName: user.fullName,
    isPhoneVerified: user.isPhoneVerified,
    createdAt: user.createdAt.toISOString(),
  };
}
