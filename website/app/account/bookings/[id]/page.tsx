import { RequireAuth } from "../../../../components/account/RequireAuth";
import { BookingDetailPanel } from "../../../../components/account/BookingDetailPanel";

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactNode> {
  const { id } = await params;
  return (
    <RequireAuth title="Log in to see this booking">
      <BookingDetailPanel bookingId={id} />
    </RequireAuth>
  );
}
