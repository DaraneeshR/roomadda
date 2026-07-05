import { formatPaise } from "@roomadda/shared";

/**
 * Format a SIGNED paise figure for display. The shared `formatPaise` is the one
 * sanctioned money formatter but (by invariant) rejects negatives; ERP `netPaise`
 * may be negative (RoomAdda owes the PG owner — §15.5). So we hand the magnitude
 * to `formatPaise` and only prepend a minus glyph — no money arithmetic here, just
 * a display sign. Never sum/derive money in the client (see /CLAUDE.md money rule).
 */
export function formatSignedPaise(paise: number): string {
  return paise < 0 ? `-${formatPaise(-paise)}` : formatPaise(paise);
}
