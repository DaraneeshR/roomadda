/**
 * HTTP smoke for the admin surface: KYC review, ad approval -> featured, and
 * cash reconciliation — all audited. Run against a server on 127.0.0.1:3001.
 *   node --import tsx scripts/admin-smoke.ts
 */
import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { signAccessToken } from "../src/lib/tokens.js";
import { env } from "../src/config/env.js";

const BASE = "http://127.0.0.1:3001";
let failures = 0;
function check(label: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures += 1;
}
async function http(method: string, path: string, opts: { token?: string; body?: unknown; rawBody?: Buffer; headers?: Record<string, string> } = {}): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: Buffer | string | undefined;
  if (opts.rawBody) { headers["Content-Type"] = "application/json"; body = opts.rawBody; }
  else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as unknown) : undefined };
}
const phone = (): string => "+9112" + Math.floor(Math.random() * 1e8).toString().padStart(8, "0");
const items = (j: unknown): Array<Record<string, unknown>> => ((j as { items?: Array<Record<string, unknown>> }).items ?? []);

async function main(): Promise<void> {
  const admin = await prisma.user.create({ data: { phone: phone(), fullName: "Admin", role: "ADMIN", isPhoneVerified: true } });
  const host = await prisma.user.create({ data: { phone: phone(), fullName: "Host", role: "HOST", isPhoneVerified: true } });
  const tenant = await prisma.user.create({ data: { phone: phone(), fullName: "Tenant", role: "TENANT", isPhoneVerified: true } });
  const agent = await prisma.user.create({ data: { phone: phone(), fullName: "Agent", role: "AGENT", isPhoneVerified: true } });
  const kyc = await prisma.kycRecord.create({ data: { userId: tenant.id, status: "PENDING", docType: "AADHAAR", docRef: "ref" } });
  const listing = await prisma.pgListing.create({ data: { hostId: host.id, alias: "AdminSmoke", areaLabel: "A", city: "C", actualName: "Real", fullAddress: "1 Rd", pincode: "560001", latitude: 12.9, longitude: 77.6, status: "PUBLISHED" } });
  const room = await prisma.room.create({ data: { listingId: listing.id, name: "R", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 } });
  const bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 6)}`, status: "AVAILABLE" } });

  const adminT = await signAccessToken({ sub: admin.id, role: "ADMIN" });
  const hostT = await signAccessToken({ sub: host.id, role: "HOST" });
  const tenantT = await signAccessToken({ sub: tenant.id, role: "TENANT" });
  const agentT = await signAccessToken({ sub: agent.id, role: "AGENT" });

  // ===== 1) KYC review =====
  const kycList = await http("GET", "/v1/admin/kyc?status=PENDING&limit=50", { token: adminT });
  check("admin KYC queue lists the pending record", items(kycList.json).some((k) => k.id === kyc.id));
  const kycApprove = await http("POST", `/v1/admin/kyc/${kyc.id}/approve`, { token: adminT });
  const kycRow = await prisma.kycRecord.findUnique({ where: { id: kyc.id } });
  check("admin approves KYC -> VERIFIED", kycApprove.status === 200 && kycRow?.status === "VERIFIED");
  const kycAudit = await prisma.auditLog.findFirst({ where: { action: "kyc.approved", targetId: kyc.id } });
  check("KYC approval audited (actor=admin)", kycAudit?.actorId === admin.id);

  // non-admin denied
  const denied = await http("GET", "/v1/admin/kyc", { token: hostT });
  check("non-admin denied on admin route -> 403", denied.status === 403);

  // ===== 2) Ad approval -> featured =====
  await http("PUT", "/v1/ad-pricing/DAY", { token: adminT, body: { pricePaise: 50_000, isActive: true } });
  const created = await http("POST", "/v1/ads", { token: hostT, body: { listingId: listing.id, slotType: "DAY", startDate: new Date().toISOString() } });
  const adId = (created.json as { adSlotId?: string }).adSlotId ?? "";
  const adOrder = (created.json as { razorpayOrder?: { orderId: string } }).razorpayOrder?.orderId ?? "";
  check("host buys ad -> PENDING_PAYMENT + order", created.status === 201 && adId !== "" && adOrder !== "");

  // webhook capture for the ad order
  const adPayload = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_ad", order_id: adOrder, amount: 50_000 } } } });
  const adRaw = Buffer.from(adPayload, "utf8");
  const adSig = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(adRaw).digest("hex");
  await http("POST", "/v1/webhooks/razorpay", { rawBody: adRaw, headers: { "X-Razorpay-Signature": adSig, "X-Razorpay-Event-Id": `evt_adsmoke_${randomUUID()}` } });
  const afterPay = await prisma.adSlot.findUnique({ where: { id: adId } });
  check("ad webhook capture -> PENDING_APPROVAL (not approved)", afterPay?.status === "PENDING_APPROVAL");

  const pending = await http("GET", "/v1/ads/pending?limit=50", { token: adminT });
  check("admin pending-ads queue lists the ad", items(pending.json).some((a) => a.id === adId));
  const approve = await http("POST", `/v1/ads/${adId}/approve`, { token: adminT });
  check("admin approves ad -> APPROVED", approve.status === 200);
  const adAudit = await prisma.auditLog.findFirst({ where: { action: "ad.approved", targetId: adId } });
  check("ad approval audited", adAudit?.actorId === admin.id);

  const featured = await http("GET", "/v1/featured?limit=20", { token: undefined });
  check("featured includes the approved+in-window+published listing", items(featured.json).some((l) => l.id === listing.id));
  const noLeak = items(featured.json).every((l) => !("fullAddress" in l) && !("latitude" in l));
  check("featured items are masked (no exact geo/address)", noLeak);

  // ===== 3) Cash reconciliation (verified tenant) =====
  const hold = await http("POST", "/v1/bookings", { token: tenantT, body: { bedId: bed.id } });
  const booking = (hold.json as { booking?: { id: string; tokenAmountPaise: number } }).booking;
  const token = booking?.tokenAmountPaise ?? 0;
  const pay = await http("POST", `/v1/bookings/${booking?.id}/payment`, { token: tenantT, body: { method: "CASH", onlinePaise: 0, cashPaise: token, agentId: agent.id } });
  const cashId = (pay.json as { cashCollectionId?: string }).cashCollectionId ?? "";
  check("verified tenant books + cash payment created", hold.status === 201 && !!cashId);

  await http("PATCH", `/v1/cash-collections/${cashId}/collect`, { token: agentT });
  const cih = await http("GET", "/v1/admin/agents/cash-in-hand?limit=50", { token: adminT });
  check("cash-in-hand shows the agent's collected amount", items(cih.json).some((a) => a.agentId === agent.id && a.cashInHandPaise === token));
  const queue = await http("GET", "/v1/admin/cash-collections?limit=50", { token: adminT });
  check("reconciliation queue lists the collected cash", items(queue.json).some((c) => c.id === cashId));

  const recon = await http("PATCH", `/v1/cash-collections/${cashId}/reconcile`, { token: adminT });
  const ccRow = await prisma.cashCollection.findUnique({ where: { id: cashId } });
  check("admin reconciles -> RECONCILED", recon.status === 200 && ccRow?.status === "RECONCILED");
  const reconAudit = await prisma.auditLog.findFirst({ where: { action: "cash.reconciled", targetId: booking?.id ?? "" } });
  check("reconciliation audited", reconAudit?.actorId === admin.id);

  // ===== cleanup =====
  await prisma.adSlot.deleteMany({ where: { listingId: listing.id } });
  await prisma.paymentTransaction.deleteMany({ where: { payment: { booking: { listingId: listing.id } } } });
  await prisma.payment.deleteMany({ where: { booking: { listingId: listing.id } } });
  await prisma.cashCollection.deleteMany({ where: { agentId: agent.id } });
  await prisma.booking.deleteMany({ where: { listingId: listing.id } });
  await prisma.bed.deleteMany({ where: { room: { listingId: listing.id } } });
  await prisma.room.deleteMany({ where: { listingId: listing.id } });
  await prisma.pgListing.deleteMany({ where: { id: listing.id } });
  await prisma.kycRecord.deleteMany({ where: { userId: tenant.id } });
  await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_adsmoke_" } } });
  await prisma.auditLog.deleteMany({ where: { actorId: admin.id } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, host.id, tenant.id, agent.id] } } });

  console.log(failures === 0 ? "\nALL ADMIN SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
