import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { RoomieWidget } from "../components/RoomieWidget";

export const metadata: Metadata = {
  metadataBase: new URL("https://roomadda.example"),
  title: {
    default: "RoomAdda — Find PG accommodation across India",
    template: "%s — RoomAdda",
  },
  description:
    "Discover verified PG accommodation across India. Search by city, budget, gender and sharing type.",
};

const CITIES = ["Bengaluru", "Pune", "Hyderabad", "Mumbai"];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold text-teal-700">
              RoomAdda
            </Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              {CITIES.map((c) => (
                <Link key={c} href={`/city/${encodeURIComponent(c)}`} className="hover:text-teal-700">
                  {c}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="mt-16 border-t border-slate-200 py-8 text-center text-sm text-slate-500">
          © RoomAdda — PG accommodation across India
        </footer>
        <RoomieWidget />
      </body>
    </html>
  );
}
