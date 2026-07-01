import type { AgentVisit, InspectionPhoto, PropertyInspection } from "@prisma/client";
import type {
  AgentCheckInDto,
  AgentVisit as AgentVisitDto,
  AmenityCheck,
  Inspection,
  InspectionPhotoDto,
} from "@roomadda/shared";
import type { ZoneListing } from "./zone.js";

/**
 * Agent-surface serializers. The agent is a privileged role (see /CLAUDE.md
 * masking rule), so the unmasked property identity/address IS returned — the
 * agent must be able to navigate to and inspect the property.
 */

type VisitWithListing = AgentVisit & {
  listing: ZoneListing;
  inspection?: { status: PropertyInspection["status"] } | null;
};

function checkInDto(visit: AgentVisit): AgentCheckInDto | null {
  if (
    visit.checkInLat === null ||
    visit.checkInLng === null ||
    visit.checkInAt === null ||
    visit.checkInValid === null
  ) {
    return null;
  }
  return {
    lat: visit.checkInLat,
    lng: visit.checkInLng,
    at: visit.checkInAt.toISOString(),
    distanceM: visit.checkInDistanceM ?? 0,
    withinRange: visit.checkInValid,
  };
}

export function toAgentVisit(visit: VisitWithListing): AgentVisitDto {
  const { listing } = visit;
  return {
    id: visit.id,
    listingId: listing.id,
    alias: listing.alias,
    actualName: listing.actualName,
    areaLabel: listing.areaLabel,
    city: listing.city,
    fullAddress: listing.fullAddress,
    latitude: listing.latitude,
    longitude: listing.longitude,
    status: visit.status,
    scheduledAt: visit.scheduledAt.toISOString(),
    visitedAt: visit.visitedAt?.toISOString() ?? null,
    notes: visit.notes,
    checkIn: checkInDto(visit),
    inspectionStatus: visit.inspection?.status ?? null,
  };
}

function toInspectionPhoto(p: InspectionPhoto): InspectionPhotoDto {
  return { id: p.id, lat: p.lat, lng: p.lng, takenAt: p.takenAt.toISOString() };
}

export function toInspection(inspection: PropertyInspection & { photos: InspectionPhoto[] }): Inspection {
  return {
    id: inspection.id,
    visitId: inspection.visitId,
    listingId: inspection.listingId,
    status: inspection.status,
    amenities: (inspection.amenities as Record<string, AmenityCheck> | null) ?? null,
    roomCountListed: inspection.roomCountListed,
    roomCountActual: inspection.roomCountActual,
    cleanliness: (inspection.cleanliness as Record<string, number> | null) ?? null,
    securityInfra: (inspection.securityInfra as Record<string, boolean> | null) ?? null,
    discrepancies: inspection.discrepancies,
    recommendation: inspection.recommendation,
    notesForAdmin: inspection.notesForAdmin,
    photoCount: inspection.photos.length,
    photos: inspection.photos
      .slice()
      .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
      .map(toInspectionPhoto),
    submittedAt: inspection.submittedAt?.toISOString() ?? null,
    createdAt: inspection.createdAt.toISOString(),
    updatedAt: inspection.updatedAt.toISOString(),
  };
}
