import { randomUUID } from "node:crypto";
import { Prisma, type ServiceRequest, type UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { toPage, type Page } from "../../lib/pagination.js";
import { objectStorage, type PresignedUpload } from "../../lib/storage.js";
import { stayService } from "../stay/stay.service.js";
import {
  serviceRequestAdminInclude,
  serviceRequestDetailInclude,
  type ServiceRequestAdminRow,
  type ServiceRequestWithComments,
} from "./service-request.serializer.js";
import type {
  AdminServiceRequestsQuery,
  CreateServiceRequestInput,
  ListServiceRequestsQuery,
} from "./service-request.schema.js";

/** Urgent requests unresolved past this window are auto-escalated to admin. */
const ESCALATION_WINDOW_MS = 4 * 60 * 60 * 1000;

const EXT_FOR_MIME: Record<"image/jpeg" | "image/png", string> = { "image/jpeg": "jpg", "image/png": "png" };

/** Per-tenant private prefix; every request photo lives under it so keys can't be forged. */
function photoPrefix(userId: string): string {
  return `service-requests/${userId}/`;
}

function newTicketNumber(): string {
  return `SR-${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

const notFound = () =>
  new AppError({ statusCode: 404, code: "SERVICE_REQUEST_NOT_FOUND", message: "Service request not found" });

/** Load one request for its tenant; a foreign/absent id is 404 (never leaks existence). */
async function loadForTenant(id: string, tenantId: string): Promise<ServiceRequestWithComments> {
  const req = await prisma.serviceRequest.findUnique({ where: { id }, include: serviceRequestDetailInclude });
  if (!req || req.tenantId !== tenantId) throw notFound();
  return req;
}

export const serviceRequestService = {
  /** Presigned PUT URL for one request photo (TENANT). */
  async createPhotoUploadUrl(userId: string, contentType: "image/jpeg" | "image/png"): Promise<PresignedUpload> {
    const key = `${photoPrefix(userId)}${randomUUID()}.${EXT_FOR_MIME[contentType]}`;
    return objectStorage.presignUpload({ key, contentType });
  },

  /**
   * Raise a ticket. REQUIRES an active stay (a CONFIRMED booking whose move-in
   * has arrived) — the request attaches to it; no active stay → 403. Photo refs
   * must be the caller's own uploaded keys. The ticket number is unique (retried
   * on the rare collision).
   */
  async create(tenantId: string, input: CreateServiceRequestInput): Promise<ServiceRequestWithComments> {
    const stay = await stayService.getActiveStay(tenantId, new Date());
    if (!stay) {
      throw new AppError({ statusCode: 403, code: "NO_ACTIVE_STAY", message: "An active stay is required to raise a service request" });
    }

    const prefix = photoPrefix(tenantId);
    if (input.photoRefs.some((r) => !r.startsWith(prefix))) {
      throw new AppError({ statusCode: 422, code: "INVALID_PHOTO_REF", message: "Photo keys must come from your own upload URLs" });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await prisma.serviceRequest.create({
          data: {
            ticketNumber: newTicketNumber(),
            bookingId: stay.id,
            tenantId,
            listingId: stay.listingId,
            category: input.category,
            description: input.description,
            priority: input.priority,
            photoRefs: input.photoRefs,
          },
          include: serviceRequestDetailInclude,
        });
      } catch (err) {
        // Retry only a ticketNumber collision; rethrow anything else.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 4) continue;
        throw err;
      }
    }
    throw new AppError({ statusCode: 500, code: "TICKET_ALLOCATION_FAILED", message: "Could not allocate a ticket number", expose: false });
  },

  getDetailForTenant(id: string, tenantId: string): Promise<ServiceRequestWithComments> {
    return loadForTenant(id, tenantId);
  },

  /** The caller's own requests, newest first, cursor-paginated. */
  async listForTenant(tenantId: string, input: ListServiceRequestsQuery): Promise<Page<ServiceRequest>> {
    const rows = await prisma.serviceRequest.findMany({
      where: { tenantId, ...(input.status ? { status: input.status } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    return toPage(rows, input.limit);
  },

  /** Add a follow-up comment to the caller's own request (tenants never delete). */
  async addComment(id: string, author: { id: string; role: UserRole }, body: string): Promise<ServiceRequestWithComments> {
    await loadForTenant(id, author.id); // ownership (404 if not the caller's)
    await prisma.serviceRequestComment.create({
      data: { requestId: id, authorId: author.id, authorRole: author.role, body },
    });
    return loadForTenant(id, author.id);
  },

  /** Record the tenant's 1–5 rating — allowed only once the request is RESOLVED. */
  async rate(id: string, tenantId: string, rating: number): Promise<ServiceRequestWithComments> {
    const req = await prisma.serviceRequest.findUnique({ where: { id }, select: { tenantId: true, status: true } });
    if (!req || req.tenantId !== tenantId) throw notFound();
    if (req.status !== "RESOLVED") {
      throw new AppError({ statusCode: 409, code: "RATING_NOT_ALLOWED", message: "A request can be rated once it is resolved" });
    }
    await prisma.serviceRequest.update({ where: { id }, data: { rating } });
    return loadForTenant(id, tenantId);
  },

  /**
   * Auto-escalate Urgent requests still unresolved past the window: set the
   * `escalated` flag for admin attention. Money-neutral, idempotent (already-
   * escalated rows are excluded). Returns the count newly escalated. Run by the
   * BullMQ service-escalation job; `now` is injectable for tests.
   */
  async escalateOverdueUrgent(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - ESCALATION_WINDOW_MS);
    const result = await prisma.serviceRequest.updateMany({
      where: { priority: "URGENT", status: { not: "RESOLVED" }, escalated: false, createdAt: { lt: cutoff } },
      data: { escalated: true, escalatedAt: now },
    });
    return result.count;
  },

  /** Admin oversight list — filter by status / priority / escalation; escalated first. */
  async listForAdmin(query: AdminServiceRequestsQuery): Promise<Page<ServiceRequestAdminRow>> {
    const rows = await prisma.serviceRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.escalated !== undefined ? { escalated: query.escalated } : {}),
      },
      orderBy: [{ escalated: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: serviceRequestAdminInclude,
    });
    return toPage(rows, query.limit);
  },
};
