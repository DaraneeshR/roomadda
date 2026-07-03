import type { TokenPaymentOrder } from "./booking";

/**
 * Thin browser wrapper around Razorpay's hosted web checkout. The checkout
 * script is injected lazily (only when the user actually pays), and because our
 * bundle is nonce-trusted, `strict-dynamic` allows the injected script without
 * widening `script-src` to a host allow-list. The checkout iframe + its XHR are
 * covered by the `frame-src` / `connect-src` entries in middleware.ts.
 *
 * IMPORTANT: the `handler` success callback means "the gateway accepted the
 * payment" — it is NOT confirmation. The caller must then poll the booking until
 * the server (via the verified webhook) reports CONFIRMED (see /CLAUDE.md #2).
 */

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayInstance {
  open(): void;
  on(event: string, handler: (response: unknown) => void): void;
}
interface RazorpayCtor {
  new (options: Record<string, unknown>): RazorpayInstance;
}
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let loading: Promise<RazorpayCtor> | null = null;

/** Load checkout.js once; resolves with the global Razorpay constructor. */
function loadCheckout(): Promise<RazorpayCtor> {
  if (typeof window === "undefined") return Promise.reject(new Error("not in a browser"));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loading) return loading;
  loading = new Promise<RazorpayCtor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error("Razorpay failed to initialise"));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not load the payment gateway"));
    };
    document.body.appendChild(script);
  });
  return loading;
}

export interface CheckoutCallbacks {
  /** Gateway accepted the payment — caller MUST now poll for CONFIRMED. */
  onSubmitted: () => void;
  /** The modal was dismissed or the payment errored. */
  onFailed: (message: string) => void;
}

/** A Razorpay order as our BFF returns it (booking token or rent invoice). */
export type CheckoutOrder = NonNullable<TokenPaymentOrder["razorpayOrder"]>;

/**
 * Open the Razorpay modal for an order. Resolves once the modal is open (or
 * rejects if checkout can't load); the outcome flows through the callbacks.
 * `description` labels the payment in the modal (e.g. "Booking token", "Rent —
 * July 2026"). Used by BOTH the booking and rent flows — one gateway wrapper.
 */
export async function openCheckout(
  order: CheckoutOrder,
  cb: CheckoutCallbacks,
  description = "Payment",
): Promise<void> {
  const Razorpay = await loadCheckout();
  const rzp = new Razorpay({
    key: order.keyId,
    order_id: order.orderId,
    amount: order.amount,
    currency: order.currency,
    name: "RoomAdda",
    description,
    // handler = payment submitted to the gateway, NOT confirmed.
    handler: () => cb.onSubmitted(),
    modal: { ondismiss: () => cb.onFailed("Payment was cancelled.") },
  });
  rzp.on("payment.failed", () => cb.onFailed("Payment failed. Please try again."));
  rzp.open();
}

/** Booking-token checkout — thin wrapper over {@link openCheckout}. */
export function openTokenCheckout(order: CheckoutOrder, cb: CheckoutCallbacks): Promise<void> {
  return openCheckout(order, cb, "Booking token");
}
