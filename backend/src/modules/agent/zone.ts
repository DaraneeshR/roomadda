import type { AgentVisit } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";

/**
 * Agent ZONE-ISOLATION guard — the §9.1 zone-access invariant, enforced at the
 * API (never the UI). An agent may only read/act on leads, visits, and
 * properties in their assigned city. A Bangalore agent querying Delhi data is
 * DENIED here.
 *
 * Two layers:
 *  1. Default-deny on the zone itself — an agent with no `assignedCity` can do
 *     nothing (403 AGENT_NO_ZONE).
 *  2. Per-resource scoping — every listing-bound action resolves the target's
 *     city and rejects a mismatch as 404 (existence is never leaked across
 *     zones, mirroring the host ownership gate).
 *
 * List/aggregate queries scope with {@link zoneListingFilter} so out-of-zone
 * rows never enter a result set in the first place.
 */

const outOfZone = (): AppError =>
  // 404 (not 403): an out-of-zone id must be indistinguishable from a missing one
  // so an agent cannot probe another zone's inventory/leads by id.
  new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Not found" });

/** Normalised city comparison (trim + case-insensitive) so "Bengaluru" matches. */
export function citiesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Load the calling agent's assigned city. Throws 403 (default-deny) if the agent
 * has no zone — they can act on nothing until ADMIN assigns one.
 */
export async function getAgentCity(agentId: string): Promise<string> {
  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { role: true, assignedCity: true },
  });
  if (!agent || agent.role !== "AGENT" || !agent.assignedCity) {
    throw new AppError({
      statusCode: 403,
      code: "AGENT_NO_ZONE",
      message: "No assigned zone — an admin must assign your city before you can act",
    });
  }
  return agent.assignedCity;
}

/** A Prisma where-fragment that confines a query to the agent's city (insensitive). */
export function zoneListingFilter(agentCity: string) {
  return { city: { equals: agentCity, mode: "insensitive" as const } };
}

export interface ZoneListing {
  id: string;
  city: string;
  alias: string;
  actualName: string;
  areaLabel: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
}

/** Assert a listing is in the agent's zone; 404 on a missing or out-of-zone id. */
export async function assertListingInZone(agentCity: string, listingId: string): Promise<ZoneListing> {
  const listing = await prisma.pgListing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      city: true,
      alias: true,
      actualName: true,
      areaLabel: true,
      fullAddress: true,
      latitude: true,
      longitude: true,
    },
  });
  if (!listing || !citiesMatch(listing.city, agentCity)) throw outOfZone();
  return listing;
}

/** Resolve a room to its listing and assert the listing is in the agent's zone. */
export async function assertRoomInZone(
  agentCity: string,
  roomId: string,
): Promise<{ roomId: string; listing: ZoneListing }> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true, listingId: true } });
  if (!room) throw outOfZone();
  const listing = await assertListingInZone(agentCity, room.listingId);
  return { roomId: room.id, listing };
}

/** Resolve a bed to its listing and assert the listing is in the agent's zone. */
export async function assertBedInZone(
  agentCity: string,
  bedId: string,
): Promise<{ bedId: string; roomId: string; listing: ZoneListing }> {
  const bed = await prisma.bed.findUnique({
    where: { id: bedId },
    select: { id: true, roomId: true, room: { select: { listingId: true } } },
  });
  if (!bed) throw outOfZone();
  const listing = await assertListingInZone(agentCity, bed.room.listingId);
  return { bedId: bed.id, roomId: bed.roomId, listing };
}

/**
 * Load a visit and assert it is BOTH the calling agent's own AND in their zone.
 * Either miss is a 404 — a cross-zone or cross-agent visit id leaks nothing.
 */
export async function assertOwnedVisitInZone(
  agentId: string,
  agentCity: string,
  visitId: string,
): Promise<{ visit: AgentVisit; listing: ZoneListing }> {
  const visit = await prisma.agentVisit.findUnique({ where: { id: visitId } });
  if (!visit || visit.agentId !== agentId) throw outOfZone();
  // The listing-zone check is what closes §9.1: even the agent's OWN visit is
  // denied if the property sits in another city.
  const listing = await assertListingInZone(agentCity, visit.listingId);
  return { visit, listing };
}
