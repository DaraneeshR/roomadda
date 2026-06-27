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
    // Self-only profile. `gender` is returned ONLY here (to the user themselves);
    // no host-facing serializer ever includes it (see /CLAUDE.md privacy rules).
    gender: user.gender,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString() : null,
    occupationType: user.occupationType,
    college: user.college,
    company: user.company,
  };
}
