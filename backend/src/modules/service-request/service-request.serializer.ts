import { Prisma, type ServiceRequest } from "@prisma/client";
import type {
  ServiceRequest as ServiceRequestDTO,
  ServiceRequestAdminItem,
  ServiceRequestComment,
  ServiceRequestDetail,
} from "@roomadda/shared";

/**
 * Service-request serializer. Photos are stored as private object keys and
 * surfaced ONLY as a count (`photoCount`) — the raw keys never leave the server.
 * Detail adds the comment thread; the admin item adds who/where + escalation time.
 */
export const serviceRequestDetailInclude = {
  comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { fullName: true } } } },
} satisfies Prisma.ServiceRequestInclude;

export type ServiceRequestWithComments = Prisma.ServiceRequestGetPayload<{
  include: typeof serviceRequestDetailInclude;
}>;

export const serviceRequestAdminInclude = {
  tenant: { select: { id: true, fullName: true, phone: true } },
  listing: { select: { id: true, alias: true, city: true } },
} satisfies Prisma.ServiceRequestInclude;

export type ServiceRequestAdminRow = Prisma.ServiceRequestGetPayload<{
  include: typeof serviceRequestAdminInclude;
}>;

function base(r: ServiceRequest): ServiceRequestDTO {
  return {
    id: r.id,
    ticketNumber: r.ticketNumber,
    category: r.category,
    description: r.description,
    priority: r.priority,
    status: r.status,
    photoCount: r.photoRefs.length,
    escalated: r.escalated,
    rating: r.rating ?? null,
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export const toServiceRequest = base;

function toComment(c: ServiceRequestWithComments["comments"][number]): ServiceRequestComment {
  return {
    id: c.id,
    authorRole: c.authorRole,
    authorName: c.author.fullName,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toServiceRequestDetail(r: ServiceRequestWithComments): ServiceRequestDetail {
  return { ...base(r), comments: r.comments.map(toComment) };
}

export function toAdminItem(r: ServiceRequestAdminRow): ServiceRequestAdminItem {
  return {
    ...base(r),
    escalatedAt: r.escalatedAt?.toISOString() ?? null,
    tenant: r.tenant,
    listing: r.listing,
  };
}
