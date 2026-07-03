import type { ScarcityLevel, SocialProof } from "@roomadda/shared";
import type { SocialConfig } from "./social.config.js";

/**
 * Pure honesty-gating for the social-proof widgets. Every function takes REAL
 * measured values + the server config and returns either the widget payload (it
 * cleared its floor / is genuinely scarce) or `undefined` (OMIT — the client
 * renders nothing and cannot fake it). No I/O here, so the gates are exhaustively
 * unit-tested. See /CLAUDE.md: every number must be real.
 */

/** "Viewing now": shown only when the real distinct-session count ≥ the floor. */
export function gateViewingNow(count: number, config: SocialConfig): number | undefined {
  return count >= config.viewingFloor && count > 0 ? count : undefined;
}

/** "Booked N times in last W days": shown only when the real count ≥ the floor.
 *  `windowDays` is the window the count was actually computed for (may be null
 *  when the cron has not run yet → omit). */
export function gateBookedRecently(
  count: number,
  windowDays: number | null,
  config: SocialConfig,
): SocialProof["bookedRecently"] {
  if (windowDays === null || windowDays <= 0) return undefined;
  if (count < config.bookedFloor || count <= 0) return undefined;
  return { count, windowDays };
}

/**
 * "Only N beds left": GENUINE scarcity from live inventory. Red when fully
 * booked (0 available of a listing that has beds), amber when few remain
 * (≤ amberMax and > 0). When there is plenty of availability — or the listing
 * has no beds at all — there is no honest scarcity to show, so it is omitted.
 */
export function gateScarcity(
  availableBeds: number,
  totalBeds: number,
  config: SocialConfig,
): SocialProof["bedsLeft"] {
  if (totalBeds <= 0) return undefined; // no inventory => nothing to claim
  if (availableBeds <= 0) return { count: 0, level: "red" satisfies ScarcityLevel };
  if (availableBeds <= config.scarcityAmberMax) {
    return { count: availableBeds, level: "amber" satisfies ScarcityLevel };
  }
  return undefined; // plenty available — no false urgency
}

/** "Z have this wishlisted": shown only when the real save count ≥ the floor. */
export function gateWishlisted(count: number, config: SocialConfig): number | undefined {
  return count >= config.wishlistFloor && count > 0 ? count : undefined;
}

/** Real, measured inputs for one listing (gathered by the service). */
export interface SocialInputs {
  viewingNow: number;
  bookedCount: number;
  bookedWindowDays: number | null;
  availableBeds: number;
  totalBeds: number;
  wishlistedCount: number;
}

/**
 * Assemble the honesty-gated widget object. Only fields that cleared their floor
 * (or are genuinely scarce) are present; an all-omitted result is an empty
 * object — the honest "show nothing".
 */
export function assembleSocialProof(inputs: SocialInputs, config: SocialConfig): SocialProof {
  const social: SocialProof = {};

  const viewingNow = gateViewingNow(inputs.viewingNow, config);
  if (viewingNow !== undefined) social.viewingNow = viewingNow;

  const bookedRecently = gateBookedRecently(inputs.bookedCount, inputs.bookedWindowDays, config);
  if (bookedRecently !== undefined) social.bookedRecently = bookedRecently;

  const bedsLeft = gateScarcity(inputs.availableBeds, inputs.totalBeds, config);
  if (bedsLeft !== undefined) social.bedsLeft = bedsLeft;

  const wishlistedCount = gateWishlisted(inputs.wishlistedCount, config);
  if (wishlistedCount !== undefined) social.wishlistedCount = wishlistedCount;

  return social;
}
