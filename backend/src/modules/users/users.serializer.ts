import type { User } from "@prisma/client";

/**
 * Self-view of a user (returned to the user themselves / admins). This is NOT
 * the public listing-owner view; listing masking is handled separately.
 */
export interface SelfUserView {
  id: string;
  role: User["role"];
  phone: string;
  fullName: string;
  isPhoneVerified: boolean;
  createdAt: string;
}

export function serializeUserSelf(user: User): SelfUserView {
  return {
    id: user.id,
    role: user.role,
    phone: user.phone,
    fullName: user.fullName,
    isPhoneVerified: user.isPhoneVerified,
    createdAt: user.createdAt.toISOString(),
  };
}
