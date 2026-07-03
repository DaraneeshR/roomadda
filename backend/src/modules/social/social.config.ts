import { env } from "../../config/env.js";

/**
 * Server-side social-proof configuration: the minimum-real-value FLOOR for each
 * widget plus the "viewing now" TTL and the booked-count window. Below a floor
 * the corresponding field is OMITTED entirely (honesty gate — see modules/social
 * and /CLAUDE.md). Passed explicitly into the pure gating logic so it is fully
 * unit-testable with arbitrary thresholds; the route uses {@link socialConfig}.
 */
export interface SocialConfig {
  /** Min distinct active sessions before "viewing now" is shown. */
  viewingFloor: number;
  /** A session counts as active if it heartbeat within this many seconds. */
  viewingTtlSeconds: number;
  /** Min recent bookings before the "booked N times" widget is shown. */
  bookedFloor: number;
  /** Rolling window (days) the booked count is computed over. */
  bookedWindowDays: number;
  /** Min wishlist saves before the "Z wishlisted" widget is shown. */
  wishlistFloor: number;
  /** Show amber scarcity when available beds ≤ this (and > 0); red at 0. */
  scarcityAmberMax: number;
}

/** The live config, sourced from validated env (secrets/thresholds via env only). */
export const socialConfig: SocialConfig = {
  viewingFloor: env.SOCIAL_VIEWING_FLOOR,
  viewingTtlSeconds: env.SOCIAL_VIEWING_TTL_SECONDS,
  bookedFloor: env.SOCIAL_BOOKED_FLOOR,
  bookedWindowDays: env.SOCIAL_BOOKED_WINDOW_DAYS,
  wishlistFloor: env.SOCIAL_WISHLIST_FLOOR,
  scarcityAmberMax: env.SOCIAL_SCARCITY_AMBER_MAX,
};
