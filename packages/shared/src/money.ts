/**
 * Money helpers — the ONLY sanctioned way to move between rupees and paise and
 * to format money (see /CLAUDE.md: "Money is always integer paise").
 *
 * Invariant: a "paise" value is a safe, non-negative integer. Floats never
 * represent money in storage or transport.
 */

/** Largest amount we accept, as a guard against overflow/typos: ₹100 crore. */
const MAX_PAISE = 100_00_00_00_000;

/** Thrown when a value that must be valid paise is not. */
export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

/**
 * Assert that `value` is a valid paise amount: a non-negative safe integer
 * within range. Narrows the type so callers can treat it as money afterwards.
 */
export function assertPaise(value: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidMoneyError(`paise must be a finite number, got ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new InvalidMoneyError(`paise must be an integer, got ${value}`);
  }
  if (value < 0) {
    throw new InvalidMoneyError(`paise must be non-negative, got ${value}`);
  }
  if (value > MAX_PAISE) {
    throw new InvalidMoneyError(`paise ${value} exceeds maximum ${MAX_PAISE}`);
  }
}

/** Convert a rupee amount (max 2 decimal places) to integer paise. */
export function rupeesToPaise(rupees: number): number {
  if (typeof rupees !== "number" || !Number.isFinite(rupees)) {
    throw new InvalidMoneyError(`rupees must be a finite number, got ${String(rupees)}`);
  }
  // Round to the nearest paise to avoid binary float artefacts
  // (e.g. 19.99 * 100 === 1998.9999999999998).
  const paise = Math.round(rupees * 100);
  assertPaise(paise);
  return paise;
}

/** Convert integer paise to a rupee number. For display/format prefer formatPaise. */
export function paiseToRupees(paise: number): number {
  assertPaise(paise);
  return paise / 100;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format integer paise as an Indian-locale currency string, e.g. "₹1,234.50". */
export function formatPaise(paise: number): string {
  assertPaise(paise);
  return inrFormatter.format(paise / 100);
}
