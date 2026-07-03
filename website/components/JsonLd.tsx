/**
 * Emit a JSON-LD structured-data block. A `<script type="application/ld+json">`
 * is a NON-EXECUTED data block — the HTML parser never runs it as script — so the
 * strict CSP's `script-src` (see middleware.ts) does not block it and it needs no
 * nonce. Kept as a tiny sync component so it composes as a normal JSX child.
 */
export function JsonLd({ data }: { data: unknown }): React.ReactNode {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
