import type { Metadata } from "next";
import { KycPanel } from "../../../components/kyc/KycPanel";

export const metadata: Metadata = {
  title: "KYC verification",
  // This is a private account area — keep it out of search indexes.
  robots: { index: false, follow: false },
};

export default function KycPage(): React.ReactNode {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">KYC verification</h1>
      <p className="mt-1 text-slate-600">
        Verify your identity so you can book a PG. You can keep browsing without it.
      </p>
      <div className="mt-6">
        <KycPanel />
      </div>
    </div>
  );
}
