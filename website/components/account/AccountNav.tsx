"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sub-navigation for the tenant portal. Highlights the active section. */
const TABS = [
  { href: "/account/dashboard", label: "My stay" },
  { href: "/account/bookings", label: "My bookings" },
  { href: "/account/rent", label: "Pay rent" },
  { href: "/account/wishlist", label: "Wishlist" },
  { href: "/account/kyc", label: "KYC" },
];

export function AccountNav(): React.ReactNode {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
              active
                ? "border-teal-600 text-teal-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
