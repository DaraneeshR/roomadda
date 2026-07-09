import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import {
  addRevisionSchema,
  allocateEmployeeSchema,
  assignAccountManagerSchema,
  buildQuotationSchema,
  corporateListQuerySchema,
  corporatePipelineQuerySchema,
  createCompanySchema,
  createEmployeeSchema,
  createEnquirySchema,
  respondQuotationSchema,
  settleInvoiceOfflineSchema,
  uuidParamSchema,
} from "./corporate.schema.js";
import { resolveCompanyAdminContext, resolveCompanyContext } from "./corporate.access.js";
import { corporateCompanyService } from "./corporate.company.service.js";
import { corporateDirectoryService } from "./corporate.directory.service.js";
import { corporateEnquiryService } from "./corporate.enquiry.service.js";
import { corporateQuotationService } from "./corporate.quotation.service.js";
import { corporateBookingService } from "./corporate.booking.service.js";
import { corporateInvoiceService } from "./corporate.invoice.service.js";
import { corporateEmployeeService } from "./corporate.employee.js";

/**
 * Corporate (B2B) routes. Two audiences:
 *  - COMPANY (HR/admin seat): every route resolves the caller's CompanyUser seat and
 *    is scoped to that one company (cross-company data is 404). No platform-role gate
 *    — a company seat can sit on any login; membership IS the authorization.
 *  - ADMIN (platform): the CRM/sales pipeline + corporate finance, default-deny to
 *    the ADMIN role. Every mutation is audited in the service layer.
 *  - EMPLOYEE self-view: /corporate/my-stays — any authenticated user; returns only
 *    their own allocated stays (no rate/finance — the C0 privacy invariant).
 */
export const corporateRoutes: FastifyPluginAsync = async (app) => {
  // ===== EMPLOYEE self-view ===============================================
  app.get("/corporate/my-stays", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const stays = await corporateEmployeeService.listMyStays(user.id);
    return reply.send({ stays });
  });

  // ===== COMPANY (HR) — scoped to the caller's own company ================
  app.get("/corporate/overview", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    return reply.send({ overview: await corporateCompanyService.overview(ctx) });
  });

  app.get("/corporate/employees", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const query = corporateListQuerySchema.parse(request.query);
    const page = await corporateDirectoryService.listEmployees(ctx, query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.post("/corporate/employees", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyAdminContext(user.id);
    const body = createEmployeeSchema.parse(request.body);
    const employee = await corporateDirectoryService.createEmployee(user.id, ctx, body);
    return reply.status(201).send({ employee });
  });

  app.post("/corporate/enquiries", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const body = createEnquirySchema.parse(request.body);
    const enquiry = await corporateEnquiryService.createEnquiry(user.id, ctx, body);
    return reply.status(201).send({ enquiry });
  });

  app.get("/corporate/enquiries", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const query = corporateListQuerySchema.parse(request.query);
    const page = await corporateEnquiryService.listForCompany(ctx, query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.get("/corporate/quotations", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const query = corporateListQuerySchema.parse(request.query);
    const page = await corporateQuotationService.listForCompany(ctx, query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.get("/corporate/quotations/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const { id } = uuidParamSchema.parse(request.params);
    return reply.send({ quotation: await corporateQuotationService.getById(id, ctx) });
  });

  app.post("/corporate/quotations/:id/respond", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const { id } = uuidParamSchema.parse(request.params);
    const body = respondQuotationSchema.parse(request.body);
    return reply.send({ quotation: await corporateQuotationService.respond(user.id, ctx, id, body) });
  });

  app.get("/corporate/bookings", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const query = corporateListQuerySchema.parse(request.query);
    const page = await corporateBookingService.listForCompany(ctx, query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.get("/corporate/bookings/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const { id } = uuidParamSchema.parse(request.params);
    return reply.send({ booking: await corporateBookingService.getById(id, ctx) });
  });

  app.post("/corporate/bookings/:id/allocate", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyAdminContext(user.id);
    const { id } = uuidParamSchema.parse(request.params);
    const body = allocateEmployeeSchema.parse(request.body);
    return reply.send({ booking: await corporateBookingService.allocateEmployee(user.id, ctx, id, body) });
  });

  app.get("/corporate/invoices", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const query = corporateListQuerySchema.parse(request.query);
    const page = await corporateInvoiceService.listForCompany(ctx, query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.get("/corporate/invoices/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const { id } = uuidParamSchema.parse(request.params);
    return reply.send({ invoice: await corporateInvoiceService.getById(id, ctx) });
  });

  // Initiate ONLINE payment — returns a server-owned Razorpay order. The invoice
  // reaches PAID ONLY via the verified webhook (never this callback).
  app.post("/corporate/invoices/:id/pay", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const ctx = await resolveCompanyContext(user.id);
    const { id } = uuidParamSchema.parse(request.params);
    return reply.status(201).send(await corporateInvoiceService.createPaymentOrder(ctx, id));
  });

  // ===== ADMIN — corporate CRM / pipeline / finance =======================
  app.post("/corporate/admin/companies", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const user = getAuthUser(request);
    const body = createCompanySchema.parse(request.body);
    return reply.status(201).send({ company: await corporateCompanyService.createCompany(user.id, body) });
  });

  app.get("/corporate/admin/companies", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const query = corporateListQuerySchema.parse(request.query);
    const page = await corporateCompanyService.listCompanies(query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.post("/corporate/admin/companies/:id/account-manager", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = uuidParamSchema.parse(request.params);
    const body = assignAccountManagerSchema.parse(request.body);
    return reply.send({ company: await corporateCompanyService.assignAccountManager(user.id, id, body.accountManagerId) });
  });

  app.get("/corporate/admin/enquiries", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const query = corporatePipelineQuerySchema.parse(request.query);
    const page = await corporateEnquiryService.listPipeline(query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.get("/corporate/admin/quotations", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const query = corporateListQuerySchema.parse(request.query);
    const page = await corporateQuotationService.listAll(query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.get("/corporate/admin/quotations/:id", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = uuidParamSchema.parse(request.params);
    return reply.send({ quotation: await corporateQuotationService.getById(id) });
  });

  app.post("/corporate/admin/quotations", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const user = getAuthUser(request);
    const body = buildQuotationSchema.parse(request.body);
    return reply.status(201).send({ quotation: await corporateQuotationService.buildQuotation(user.id, body) });
  });

  app.post("/corporate/admin/quotations/:id/revisions", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = uuidParamSchema.parse(request.params);
    const body = addRevisionSchema.parse(request.body);
    return reply.status(201).send({ quotation: await corporateQuotationService.addRevision(user.id, id, body) });
  });

  app.post("/corporate/admin/quotations/:id/send", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = uuidParamSchema.parse(request.params);
    return reply.send({ quotation: await corporateQuotationService.sendQuotation(user.id, id) });
  });

  app.post("/corporate/admin/quotations/:id/convert", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = uuidParamSchema.parse(request.params);
    return reply.status(201).send({ booking: await corporateBookingService.convertQuotation(user.id, id) });
  });

  app.get("/corporate/admin/bookings", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const query = corporateListQuerySchema.parse(request.query);
    const page = await corporateBookingService.listAll(query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.post("/corporate/admin/bookings/:id/confirm", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = uuidParamSchema.parse(request.params);
    return reply.send({ booking: await corporateBookingService.confirmBooking(user.id, id) });
  });

  app.post("/corporate/admin/bookings/:id/invoice", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = uuidParamSchema.parse(request.params);
    return reply.status(201).send({ invoice: await corporateInvoiceService.generateInvoice(user.id, id) });
  });

  app.get("/corporate/admin/invoices", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const query = corporateListQuerySchema.parse(request.query);
    const page = await corporateInvoiceService.listAll(query);
    return reply.send({ items: page.items, nextCursor: page.nextCursor });
  });

  app.post("/corporate/admin/invoices/:id/settle-offline", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = uuidParamSchema.parse(request.params);
    const body = settleInvoiceOfflineSchema.parse(request.body);
    return reply.send({ invoice: await corporateInvoiceService.settleOffline(user.id, id, body) });
  });

  app.get("/corporate/admin/finance", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (_request, reply) => {
    return reply.send({ summary: await corporateCompanyService.financeSummary() });
  });
};
