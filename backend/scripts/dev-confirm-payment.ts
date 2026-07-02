/**
 * DEV-ONLY payment confirmer. Run with:
 *   pnpm --filter @roomadda/backend demo:confirm            # newest pending online payment
 *   pnpm --filter @roomadda/backend demo:confirm <bookingId>
 *
 * Why this exists: payment truth is a signature-verified Razorpay webhook (see
 * /CLAUDE.md #2) — the client never confirms a booking. Locally the Razorpay
 * gateway is stubbed (no real order) and, even with a real test key, Razorpay's
 * server→server webhook cannot reach `localhost`. So there is no way for a real
 * gateway callback to arrive. This script fires the SAME webhook the gateway
 * would (`payment.captured`), signed with the local RAZORPAY_WEBHOOK_SECRET, so
 * the booking settles to CONFIRMED exactly as it would in production — with zero
 * external services. It changes no app code; it just calls the public webhook.
 *
 * Prereq: in the tenant app, book a bed and tap "Pay token online" once (this
 * creates the Payment + Razorpay order). Then run this to confirm it.
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const PORT = process.env.PORT ?? "3001";
const WEBHOOK_URL = `http://localhost:${PORT}/v1/webhooks/razorpay`;

async function main(): Promise<void> {
  if (!WEBHOOK_SECRET) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET is not set (check backend/.env).");
  }

  const bookingId = process.argv[2]; // optional target

  // The booking's online leg: a Payment with a Razorpay order whose RAZORPAY
  // transaction is still CREATED (i.e. awaiting the capture webhook).
  const payment = await prisma.payment.findFirst({
    where: {
      razorpayOrderId: { not: null },
      transactions: { some: { method: "RAZORPAY", status: "CREATED" } },
      ...(bookingId ? { bookingId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { transactions: true },
  });

  if (!payment?.razorpayOrderId) {
    console.error(
      bookingId
        ? `No pending online payment found for booking ${bookingId}.`
        : "No booking is awaiting an online payment.",
    );
    console.error(
      "→ In the tenant app: book a bed, then tap 'Pay token online' once to create the order. Then re-run this.",
    );
    process.exitCode = 1;
    return;
  }

  const txn = payment.transactions.find((t) => t.method === "RAZORPAY" && t.status === "CREATED");
  const amount = txn?.amountPaise ?? payment.amountPaise;

  // The exact bytes we sign MUST be the exact bytes we send (raw-body HMAC).
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: `pay_dev_${Date.now()}`,
          order_id: payment.razorpayOrderId,
          amount,
        },
      },
    },
  });
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  console.log(`Firing payment.captured for booking ${payment.bookingId}`);
  console.log(`  order_id=${payment.razorpayOrderId} amount=${amount} → ${WEBHOOK_URL}`);

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature,
      "x-razorpay-event-id": `dev_${Date.now()}`,
    },
    body: rawBody,
  }).catch((err: unknown) => {
    throw new Error(`Could not reach the backend at ${WEBHOOK_URL}. Is it running? (${String(err)})`);
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Webhook rejected (HTTP ${res.status}): ${body}`);
  }
  console.log(`  webhook accepted: ${body}`);

  const booking = await prisma.booking.findUnique({
    where: { id: payment.bookingId },
    select: { status: true },
  });
  console.log(`✅  Booking ${payment.bookingId} is now ${booking?.status}. The app poller will show CONFIRMED.`);
}

main()
  .catch((err) => {
    console.error("❌ ", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
