import { ListingForm } from "../../../../../components/host/ListingForm";

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactNode> {
  const { id } = await params;
  return <ListingForm listingId={id} />;
}
