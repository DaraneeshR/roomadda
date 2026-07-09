import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CorporateNav } from "../../components/corporate/CorporateNav";
import { RequireCorporate } from "../../components/corporate/RequireCorporate";

export const metadata: Metadata = {
  // A private company workspace — keep it out of search indexes.
  robots: { index: false, follow: false },
};

/** Shell for the company Corporate Dashboard: the membership gate + sub-nav + page. */
export default function CorporateLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <RequireCorporate>
        <CorporateNav />
        {children}
      </RequireCorporate>
    </main>
  );
}
