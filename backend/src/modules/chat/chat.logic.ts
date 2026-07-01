/**
 * NO phone numbers in chat (see /CLAUDE.md: contact details are never exchanged
 * in chat — the platform mediates the relationship). Pure so it is unit-tested.
 *
 * Detects a phone-like token: a run of digits and common phone separators
 * (`+ ( ) - . ` and spaces) that contains at least 10 digits. This catches
 * "9876543210", "+91 98765 43210" and "98765-43210" without flagging short
 * numbers like a room number or a 6-digit pincode, or comma-grouped prices.
 */
const PHONE_LIKE = /\+?\d[\d\s().-]{7,}\d/g;

export function containsPhoneNumber(text: string): boolean {
  const matches = text.match(PHONE_LIKE);
  if (!matches) return false;
  return matches.some((m) => m.replace(/\D/g, "").length >= 10);
}
