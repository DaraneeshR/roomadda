import Link from "next/link";
import { breadcrumbJsonLd, type Crumb } from "../lib/seo";
import { JsonLd } from "./JsonLd";

/**
 * A crawlable breadcrumb trail with matching BreadcrumbList JSON-LD. Visible
 * links give crawlers real navigation; the structured data enables breadcrumb
 * rich results. The last crumb is the current page (no link).
 */
export function Breadcrumb({ items }: { items: Crumb[] }): React.ReactNode {
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-500">
        <ol className="flex flex-wrap items-center gap-1">
          {items.map((c, i) => {
            const last = i === items.length - 1;
            return (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {c.href && !last ? (
                  <Link href={c.href} className="hover:text-teal-700">
                    {c.label}
                  </Link>
                ) : (
                  <span className={last ? "text-slate-700" : undefined} aria-current={last ? "page" : undefined}>
                    {c.label}
                  </span>
                )}
                {!last && <span aria-hidden className="text-slate-300">/</span>}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd data={breadcrumbJsonLd(items)} />
    </>
  );
}
