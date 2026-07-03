/**
 * Money helpers — re-exported from @roomadda/shared, the canonical source per
 * /CLAUDE.md ("Convert/format only via the shared money helpers"). Backend code
 * imports from here for a short, stable path; the implementation lives in
 * packages/shared/src/money.ts.
 */
export {
  rupeesToPaise,
  paiseToRupees,
  formatPaise,
  assertPaise,
  effectiveTokenPaise,
  InvalidMoneyError,
} from "@roomadda/shared";
