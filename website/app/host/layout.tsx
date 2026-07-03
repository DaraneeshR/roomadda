import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HostNav } from "../../components/host/HostNav";
import { RequireHost } from "../../components/host/RequireHost";

export const metadata: Metadata = {
  // The host portal is a private operations area — keep it out of search indexes.
  robots: { index: false, follow: false },
};

/** Shared shell for the HOST-only portal: the gate + a section sub-nav + the page. */
export default function HostLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <RequireHost>
        <HostNav />
        {children}
      </RequireHost>
    </main>
  );
}
