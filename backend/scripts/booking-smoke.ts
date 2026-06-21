/**
 * HTTP smoke test for the booking + token-payment + webhook flow.
 * Run against a server already listening on 127.0.0.1:3001 (uses the same
 * backend/.env, so minted tokens + webhook signatures match the server).
 *
 *   node --import tsx scripts/booking-smoke.ts
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

interface HttpResult {
  status: number;
  json: unknown;
}
async function http(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; rawBody?: Buffer; headers?: Record<string, string> } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: Buffer | string | undefined;
  if (opts.rawBody) {
    headers["Content-Type"] = "application/json";
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as unknown) : undefined };
}

const phone = (): string => "+9111" + Math.floor(Math.random() * 1e8).toString().padStart(8, "0");
const errCode = (json: unknown): string | undefined =>
  (json as { error?: { code?: string } } | undefined)?.error?.code;

async function main(): Promise<void> {
  const host = await prisma.user.create({ data: { phone: phone(), fullName: "H", role: "HOST", isPhoneVerified: true } });
  const tenant = await prisma.user.create({ data: { phone: phone(), fullName: "T", role: "TENANT", isPhoneVerified: true } });
  const tenantNoKyc = await prisma.user.create({ data: { phone: phone(), fullName: "TN", role: "TENANT", isPhoneVerified: true } });
  await prisma.kycRecord.create({ data: { userId: tenant.id, status: "VERIFIED", docType: "AADHAAR", docRef: "ref" } });

  const listing = await prisma.pgListing.create({
    data: {
      hostId: host.id, alias: "Smoke", areaLabel: "A", city: "C", actualName: "Real", fullAddress: "1 Rd",
      pincode: "560001", latitude: 12.9, longitude: 77.6, status: "PUBLISHED",
    },
  });
  const room = await prisma.room.create({ data: { listingId: listing.id, name: "R", sharingType: 2, monthlyRentPaise: 1_000_000, depositPaise: 500_000 } });
  const bed = await prisma.bed.create({ data: { roomId: room.id, label: `B-${randomUUID().slice(0, 6)}`, status: "AVAILABLE" } });

  const tenantToken = await signAccessToken({ sub: tenant.id, role: "TENANT" });
  const noKycToken = await signAccessToken({ sub: tenantNoKyc.id, role: "TENANT" });

  // KYC gate
  const noKyc = await http("POST", "/v1/bookings", { token: noKycToken, body: { bedId: bed.id } });
  check(`booking without KYC -> 403 ${errCode(noKyc.json)}`, noKyc.status === 403 && errCode(noKyc.json) === "KYC_REQUIRED");

  // Hold
  const holdRes = await http("POST", "/v1/bookings", { token: tenantToken, body: { bedId: bed.id } });
  const booking = (holdRes.json as { booking?: { id: string; status: string; tokenAmountPaise: number; holdExpiresAt: string | null } }).booking;
  check("hold created TOKEN_PENDING + holdExpiresAt", holdRes.status === 201 && booking?.status === "TOKEN_PENDING" && !!booking?.holdExpiresAt);
  const bookingId = booking?.id ?? "";
  const token = booking?.tokenAmountPaise ?? 0;

  // Payment (online) — must NOT confirm
  const payRes = await http("POST", `/v1/bookings/${bookingId}/payment`, { token: tenantToken, body: { method: "ONLINE", onlinePaise: token, cashPaise: 0 } });
  const order = (payRes.json as { razorpayOrder?: { orderId: string } }).razorpayOrder?.orderId ?? "";
  const afterPay = await prisma.booking.findUnique({ where: { id: bookingId } });
  check("payment returns order; booking still TOKEN_PENDING (no confirm)", payRes.status === 201 && order !== "" && afterPay?.status === "TOKEN_PENDING");

  // Webhook payload
  const payload = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_smoke", order_id: order, amount: token } } } });
  const raw = Buffer.from(payload, "utf8");
  const sig = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");

  // Bad signature -> 400
  const bad = await http("POST", "/v1/webhooks/razorpay", { rawBody: raw, headers: { "X-Razorpay-Signature": "deadbeef", "X-Razorpay-Event-Id": "evt_smoke_bad" } });
  check(`webhook bad signature -> ${bad.status}`, bad.status === 400);

  // Valid -> confirms
  const ok = await http("POST", "/v1/webhooks/razorpay", { rawBody: raw, headers: { "X-Razorpay-Signature": sig, "X-Razorpay-Event-Id": "evt_smoke_1" } });
  const confirmed = await prisma.booking.findUnique({ where: { id: bookingId } });
  const bedAfter = await prisma.bed.findUnique({ where: { id: bed.id } });
  check("valid webhook -> processed, booking CONFIRMED, bed BOOKED", (ok.json as { status?: string }).status === "processed" && confirmed?.status === "CONFIRMED" && bedAfter?.status === "BOOKED");

  // Replay -> duplicate, no double capture
  const replay = await http("POST", "/v1/webhooks/razorpay", { rawBody: raw, headers: { "X-Razorpay-Signature": sig, "X-Razorpay-Event-Id": "evt_smoke_1" } });
  const capCount = await prisma.paymentTransaction.count({ where: { payment: { bookingId }, status: "CAPTURED" } });
  check("replay -> duplicate + exactly 1 captured txn", (replay.json as { status?: string }).status === "duplicate" && capCount === 1);

  // Cleanup
  await prisma.paymentTransaction.deleteMany({ where: { payment: { booking: { listingId: listing.id } } } });
  await prisma.payment.deleteMany({ where: { booking: { listingId: listing.id } } });
  await prisma.booking.deleteMany({ where: { listingId: listing.id } });
  await prisma.bed.deleteMany({ where: { room: { listingId: listing.id } } });
  await prisma.room.deleteMany({ where: { listingId: listing.id } });
  await prisma.pgListing.deleteMany({ where: { id: listing.id } });
  await prisma.kycRecord.deleteMany({ where: { userId: tenant.id } });
  await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_smoke_" } } });
  await prisma.user.deleteMany({ where: { id: { in: [host.id, tenant.id, tenantNoKyc.id] } } });

  console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} SMOKE CHECK(S) FAILED`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
