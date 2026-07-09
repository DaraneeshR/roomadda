import { prisma } from "../../lib/prisma.js";
import type { EmployeeStayView } from "@roomadda/shared";

/**
 * Employee-scoped reads — the STRUCTURAL half of the employee-privacy invariant
 * (C0). An allocated employee may see ONLY their own stay(s): dates, room tier,
 * masked area/city, reservation status, and — once CONFIRMED — the real property
 * name + check-in QR. They must NEVER see a negotiated rate, company finance,
 * another employee, or an owner payout.
 *
 * This is enforced STRUCTURALLY, not by a runtime filter that could be forgotten:
 *  - this file imports NO pricing/finance module (no erp.*, no money engine, no
 *    quotation/invoice/booking-total access);
 *  - every Prisma `select` below lists a fixed set of SAFE columns — the
 *    money-bearing tables (quotations, quotation_revisions, corporate_bookings.total,
 *    corporate_invoices) are never traversed;
 *  - scoping is by the caller's OWN User id → their Employee rows → their
 *    allocations, so another employee's stay is unreachable.
 *
 * The output DTO (`EmployeeStayView`) has no money field at all, so even a future
 * careless edit cannot leak a rate through this path.
 */
export const corporateEmployeeService = {
  /**
   * Every corporate stay allocated to the caller (identified by their consumer
   * User id, linked to an Employee row by phone). Newest first. No money, ever.
   */
  async listMyStays(userId: string): Promise<EmployeeStayView[]> {
    const allocations = await prisma.employeeAllocation.findMany({
      // Scope: only allocations whose employee directory row is linked to THIS user.
      where: { employee: { userId } },
      orderBy: { createdAt: "desc" },
      // Explicit SAFE selection — no totalPaise / quotation / invoice traversal.
      select: {
        id: true,
        status: true,
        employee: { select: { company: { select: { name: true } } } },
        hotelReservation: {
          select: {
            status: true,
            checkIn: true,
            checkOut: true,
            qrCodeToken: true,
            // Property details reached via the category's listing relation
            // (HotelReservation.listingId is a denormalised column, not a relation).
            category: {
              select: {
                tier: true,
                listing: { select: { actualName: true, areaLabel: true, city: true } },
              },
            },
          },
        },
      },
    });

    return allocations.map((a): EmployeeStayView => {
      const r = a.hotelReservation;
      const listing = r?.category.listing;
      const confirmed = r?.status === "CONFIRMED";
      return {
        allocationId: a.id,
        status: a.status,
        companyName: a.employee.company.name,
        areaLabel: listing?.areaLabel ?? null,
        city: listing?.city ?? null,
        tier: r?.category.tier ?? null,
        checkIn: r ? r.checkIn.toISOString() : null,
        checkOut: r ? r.checkOut.toISOString() : null,
        reservationStatus: r?.status ?? null,
        // Real property name is a CONFIRMED-stay entitlement only (like a tenant).
        propertyName: confirmed ? (listing?.actualName ?? null) : null,
        // QR is minted only on CONFIRMED; null otherwise.
        qrCodeToken: confirmed ? (r?.qrCodeToken ?? null) : null,
      };
    });
  },
};
