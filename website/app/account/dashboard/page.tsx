import { RequireAuth } from "../../../components/account/RequireAuth";
import { DashboardPanel } from "../../../components/account/DashboardPanel";

export default function DashboardPage(): React.ReactNode {
  return (
    <RequireAuth title="Log in to see your stay">
      <DashboardPanel />
    </RequireAuth>
  );
}
