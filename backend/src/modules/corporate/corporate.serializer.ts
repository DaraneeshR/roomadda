import type {
  Company,
  CorporateBooking,
  CorporateEnquiry,
  CorporateInvoice,
  Employee,
  EmployeeAllocation,
  HotelReservation,
  Quotation,
  QuotationLineItem,
  QuotationRevision,
} from "@prisma/client";
import { invoiceBalancePaise } from "@roomadda/shared";
import type {
  CorporateBooking as CorporateBookingDto,
  CorporateCompany,
  CorporateEmployee,
  CorporateEnquiry as CorporateEnquiryDto,
  CorporateInvoice as CorporateInvoiceDto,
  EmployeeAllocation as EmployeeAllocationDto,
  Quotation as QuotationDto,
  QuotationLineItem as QuotationLineItemDto,
  QuotationRevision as QuotationRevisionDto,
} from "@roomadda/shared";

/** Serializers map authoritative Prisma rows to the masked/DTO shapes. Money is
 *  passed straight through (already integer paise); derived `balancePaise` uses the
 *  shared engine so it is computed in ONE place. */

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toCompany(c: Company): CorporateCompany {
  return {
    id: c.id,
    name: c.name,
    gstin: c.gstin,
    billingAddress: c.billingAddress,
    billingEmail: c.billingEmail,
    status: c.status,
    accountManagerId: c.accountManagerId,
    billingMode: c.billingMode,
    creditDays: c.creditDays,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toEmployee(e: Employee): CorporateEmployee {
  return {
    id: e.id,
    fullName: e.fullName,
    phone: e.phone,
    email: e.email,
    empCode: e.empCode,
    linkedUser: e.userId !== null,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toEnquiry(e: CorporateEnquiry): CorporateEnquiryDto {
  return {
    id: e.id,
    companyId: e.companyId,
    city: e.city,
    area: e.area,
    propertyType: e.propertyType,
    headcount: e.headcount,
    checkIn: e.checkIn.toISOString(),
    checkOut: e.checkOut.toISOString(),
    notes: e.notes,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
  };
}

function toLineItem(li: QuotationLineItem): QuotationLineItemDto {
  return {
    id: li.id,
    categoryId: li.categoryId,
    description: li.description,
    unitPricePaise: li.unitPricePaise,
    quantity: li.quantity,
    nights: li.nights,
    amountPaise: li.amountPaise,
  };
}

function toRevision(r: QuotationRevision & { lineItems: QuotationLineItem[] }): QuotationRevisionDto {
  return {
    id: r.id,
    revision: r.revision,
    subtotalPaise: r.subtotalPaise,
    taxPaise: r.taxPaise,
    totalPaise: r.totalPaise,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    lineItems: r.lineItems.map(toLineItem),
  };
}

export function toQuotation(
  q: Quotation & { revisions: (QuotationRevision & { lineItems: QuotationLineItem[] })[] },
): QuotationDto {
  return {
    id: q.id,
    companyId: q.companyId,
    enquiryId: q.enquiryId,
    status: q.status,
    currentRevision: q.currentRevision,
    validUntil: iso(q.validUntil),
    sentAt: iso(q.sentAt),
    acceptedAt: iso(q.acceptedAt),
    rejectedAt: iso(q.rejectedAt),
    createdAt: q.createdAt.toISOString(),
    // Oldest → newest so the UI renders the full negotiation history in order.
    revisions: [...q.revisions].sort((a, b) => a.revision - b.revision).map(toRevision),
  };
}

type AllocationRow = EmployeeAllocation & {
  employee: { fullName: string };
  hotelReservation: Pick<HotelReservation, "checkIn" | "checkOut" | "status"> | null;
};
type ReservationRow = Pick<HotelReservation, "id" | "checkIn" | "checkOut" | "status">;

function toAllocation(a: AllocationRow): EmployeeAllocationDto {
  return {
    id: a.id,
    employeeId: a.employeeId,
    employeeName: a.employee.fullName,
    hotelReservationId: a.hotelReservationId,
    status: a.status,
    checkIn: a.hotelReservation ? a.hotelReservation.checkIn.toISOString() : null,
    checkOut: a.hotelReservation ? a.hotelReservation.checkOut.toISOString() : null,
    reservationStatus: a.hotelReservation?.status ?? null,
  };
}

export function toBooking(
  b: CorporateBooking & { allocations: AllocationRow[]; reservations: ReservationRow[] },
): CorporateBookingDto {
  // A reservation is "allocated" when a live allocation points at it.
  const allocatedIds = new Set(
    b.allocations.filter((a) => a.status === "ALLOCATED" && a.hotelReservationId).map((a) => a.hotelReservationId),
  );
  return {
    id: b.id,
    companyId: b.companyId,
    quotationId: b.quotationId,
    status: b.status,
    totalPaise: b.totalPaise,
    confirmedAt: iso(b.confirmedAt),
    createdAt: b.createdAt.toISOString(),
    reservations: b.reservations.map((r) => ({
      id: r.id,
      checkIn: r.checkIn.toISOString(),
      checkOut: r.checkOut.toISOString(),
      status: r.status,
      allocated: allocatedIds.has(r.id),
    })),
    allocations: b.allocations.map(toAllocation),
  };
}

export function toInvoice(i: CorporateInvoice): CorporateInvoiceDto {
  return {
    id: i.id,
    companyId: i.companyId,
    corporateBookingId: i.corporateBookingId,
    billingMode: i.billingMode,
    status: i.status,
    totalPaise: i.totalPaise,
    paidPaise: i.paidPaise,
    balancePaise: invoiceBalancePaise(i.totalPaise, i.paidPaise),
    issuedAt: iso(i.issuedAt),
    dueDate: iso(i.dueDate),
    paidAt: iso(i.paidAt),
    createdAt: i.createdAt.toISOString(),
  };
}
