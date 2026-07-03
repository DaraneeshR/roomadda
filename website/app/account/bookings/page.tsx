import { RequireAuth } from "../../../components/account/RequireAuth";
import { BookingsPanel } from "../../../components/account/BookingsPanel";

export default function BookingsPage(): React.ReactNode {
  return (
    <RequireAuth title="Log in to see your bookings">
      <BookingsPanel />
    </RequireAuth>
  );
}
