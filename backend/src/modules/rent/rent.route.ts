import type { FastifyPluginAsync } from "fastify";
import { getAuthUser } from "../../plugins/auth.js";
import { rentService } from "./rent.service.js";
import { toRentInvoice } from "./rent.serializer.js";
import { buildRentReceiptPdf } from "./rent.receipt.js";
import { invoiceIdParamSchema, listRentQuerySchema } from "./rent.schema.js";

export const rentRoutes: FastifyPluginAsync = async (app) => {
  // The caller's own rent history — TENANT only, cursor-paginated, newest first.
  // The first row is the current invoice the dashboard's rent card reads.
  app.get(
    "/rent",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const query = listRentQuerySchema.parse(request.query);
      const page = await rentService.listForTenant(user.id, query);
      const now = new Date();
      return reply.send({ items: page.items.map((i) => toRentInvoice(i, now)), nextCursor: page.nextCursor });
    },
  );

  // Read one of the caller's own invoices — the mobile polls this after paying to
  // observe the webhook-driven DUE -> PAID. A foreign id returns 404 (never 403).
  app.get(
    "/rent/:id",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = invoiceIdParamSchema.parse(request.params);
      const invoice = await rentService.getInvoiceForTenant(id, user.id);
      return reply.send({ invoice: toRentInvoice(invoice, new Date()) });
    },
  );

  // Initiate a FULL-amount rent payment — returns the Razorpay order. NEVER marks
  // the invoice PAID; only the signature-verified webhook does (see /CLAUDE.md).
  app.post(
    "/rent/:id/pay",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = invoiceIdParamSchema.parse(request.params);
      const result = await rentService.payInvoice(id, user.id);
      return reply.status(201).send(result);
    },
  );

  // Downloadable PDF receipt — TENANT (own), available once the invoice is PAID.
  app.get(
    "/rent/:id/receipt",
    { preHandler: [app.authenticate, app.requireRole("TENANT")] },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = invoiceIdParamSchema.parse(request.params);
      const data = await rentService.getReceiptData(id, user.id);
      const pdf = await buildRentReceiptPdf(data);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="roomadda-rent-${id}.pdf"`)
        .send(Buffer.from(pdf));
    },
  );
};
