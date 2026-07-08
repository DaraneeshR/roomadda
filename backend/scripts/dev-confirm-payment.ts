/**
 * DEV-ONLY payment confirmer. Run with:
 *   pnpm --filter @roomadda/backend demo:confirm            # newest pending online payment (booking, else rent, else hotel)
 *   pnpm --filter @roomadda/backend demo:confirm <id>       # a specific booking / rent invoice / hotel reservation id
 *
 * Why this exists: payment truth is a signature-verified Razorpay webhook (see
 * /CLAUDE.md #2) — the client never confirms a booking or marks rent PAID.
 * Locally the Razorpay gateway is stubbed (no real order) and, even with a real
 * test key, Razorpay's server→server webhook cannot reach `localhost`. So there
 * is no way for a real gateway callback to arrive. This script fires the SAME
 * webhook the gateway would (`payment.captured`), signed with the local
 * RAZORPAY_WEBHOOK_SECRET, so the booking settles to CONFIRMED / the rent invoice
 * settles to PAID exactly as in production — with zero external services. It
 * changes no app code; it just calls the public webhook.
 *
 * It handles a booking token payment, a recurring rent invoice, AND a nightly
 * hotel reservation (B2C): the webhook dispatches by order id owner, so the same
 * signed event settles whichever one owns the order. A booking payment is
 * preferred; then a pending rent invoice; then a HELD hotel reservation
 * (optionally filtered by the id argument).
 *
 * Prereq: create the payable order first — in the tenant app/web, tap "Pay token
 * online" (booking) or "Pay rent" once. Then run this to confirm it.
 */
import "dotenv/config";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const PORT = process.env.PORT ?? "3001";
const WEBHOOK_URL = `http://localhost:${PORT}/v1/webhooks/razorpay`;

/** A payable order awaiting the capture webhook: a booking, rent invoice, or hotel reservation. */
interface PendingOrder {
  kind: "booking" | "rent" | "hotel";
  orderId: string;
  amountPaise: number;
  targetId: string;
}

/** The booking's online leg: a Payment with a still-CREATED RAZORPAY txn. */
async function findBookingOrder(id?: string): Promise<PendingOrder | null> {
  const payment = await prisma.payment.findFirst({
    where: {
      razorpayOrderId: { not: null },
      transactions: { some: { method: "RAZORPAY", status: "CREATED" } },
      ...(id ? { bookingId: id } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { transactions: true },
  });
  if (!payment?.razorpayOrderId) return null;
  const txn = payment.transactions.find((t) => t.method === "RAZORPAY" && t.status === "CREATED");
  return {
    kind: "booking",
    orderId: payment.razorpayOrderId,
    amountPaise: txn?.amountPaise ?? payment.amountPaise,
    targetId: payment.bookingId,
  };
}

/** A rent invoice with an order created but not yet PAID (awaiting the webhook). */
async function findRentOrder(id?: string): Promise<PendingOrder | null> {
  const invoice = await prisma.rentInvoice.findFirst({
    where: {
      razorpayOrderId: { not: null },
      status: { in: ["DUE", "OVERDUE"] },
      ...(id ? { id } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!invoice?.razorpayOrderId) return null;
  return { kind: "rent", orderId: invoice.razorpayOrderId, amountPaise: invoice.amountPaise, targetId: invoice.id };
}

/** A HELD hotel reservation with an order created but not yet CONFIRMED (awaiting the webhook). */
async function findHotelOrder(id?: string): Promise<PendingOrder | null> {
  const reservation = await prisma.hotelReservation.findFirst({
    where: {
      razorpayOrderId: { not: null },
      status: "HELD",
      ...(id ? { id } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!reservation?.razorpayOrderId) return null;
  // Hotel is full-stay prepay, so the capture must be the full token amount.
  return { kind: "hotel", orderId: reservation.razorpayOrderId, amountPaise: reservation.tokenAmountPaise, targetId: reservation.id };
}

async function main(): Promise<void> {
  if (!WEBHOOK_SECRET) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET is not set (check backend/.env).");
  }

  const id = process.argv[2]; // optional booking id OR rent invoice id OR hotel reservation id
  // Prefer a booking payment; fall back to a rent invoice, then a hotel reservation.
  const order = (await findBookingOrder(id)) ?? (await findRentOrder(id)) ?? (await findHotelOrder(id));

  if (!order) {
    console.error(
      id
        ? `No pending online payment, rent invoice, or hotel reservation found for id ${id}.`
        : "Nothing is awaiting an online payment (booking token, rent, or hotel).",
    );
    console.error(
      "→ First create the order: tap 'Pay token online' (booking), 'Pay rent', or 'Pay & confirm' (hotel) once, then re-run this.",
    );
    process.exitCode = 1;
    return;
  }

  // The exact bytes we sign MUST be the exact bytes we send (raw-body HMAC).
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: `pay_dev_${Date.now()}`,
          order_id: order.orderId,
          amount: order.amountPaise,
        },
      },
    },
  });
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

  console.log(`Firing payment.captured for ${order.kind} ${order.targetId}`);
  console.log(`  order_id=${order.orderId} amount=${order.amountPaise} → ${WEBHOOK_URL}`);

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

  if (order.kind === "booking") {
    const booking = await prisma.booking.findUnique({ where: { id: order.targetId }, select: { status: true } });
    console.log(`✅  Booking ${order.targetId} is now ${booking?.status}. The poller will show CONFIRMED.`);
  } else if (order.kind === "rent") {
    const invoice = await prisma.rentInvoice.findUnique({ where: { id: order.targetId }, select: { status: true } });
    console.log(`✅  Rent invoice ${order.targetId} is now ${invoice?.status}. The poller will show PAID.`);
  } else {
    const reservation = await prisma.hotelReservation.findUnique({
      where: { id: order.targetId },
      select: { status: true, qrCodeToken: true },
    });
    console.log(
      `✅  Hotel reservation ${order.targetId} is now ${reservation?.status}` +
        `${reservation?.qrCodeToken ? ` (check-in code ${reservation.qrCodeToken})` : ""}. The poller will show CONFIRMED.`,
    );
  }
}

main()
  .catch((err) => {
    console.error("❌ ", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
