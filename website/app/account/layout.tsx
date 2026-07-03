import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AccountNav } from "../../components/account/AccountNav";

export const metadata: Metadata = {
  // The tenant portal is a private area — keep it out of search indexes.
  robots: { index: false, follow: false },
};

/** Shared shell for the logged-in tenant portal: a section sub-nav + the page. */
export default function AccountLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <AccountNav />
      {children}
    </main>
  );
}
