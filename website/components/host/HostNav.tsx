"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Top-level sections of the host portal. */
const TABS = [
  { href: "/host", label: "Dashboard", exact: true },
  { href: "/host/listings", label: "Listings" },
  { href: "/host/bookings", label: "Bookings & tenants" },
  { href: "/host/operations", label: "Meals, service & revenue" },
];

/** Sub-navigation for the host portal; highlights the active section. */
export function HostNav(): React.ReactNode {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
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
