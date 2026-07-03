import { RequireAuth } from "../../../components/account/RequireAuth";
import { WishlistPanel } from "../../../components/account/WishlistPanel";

export default function WishlistPage(): React.ReactNode {
  return (
    <RequireAuth title="Log in to see your wishlist">
      <WishlistPanel />
    </RequireAuth>
  );
}
