import { RequireAuth } from "../../../components/account/RequireAuth";
import { RentPanel } from "../../../components/account/RentPanel";

export default function RentPage(): React.ReactNode {
  return (
    <RequireAuth title="Log in to pay your rent">
      <RentPanel />
    </RequireAuth>
  );
}
