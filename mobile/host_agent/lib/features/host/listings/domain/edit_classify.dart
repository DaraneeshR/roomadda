/// Client-side mirror of the backend `edit-classify.ts`. The host edit form uses
/// this PURELY to warn the host BEFORE saving ("Saving this will re-queue your
/// listing for approval"). The backend is still the source of truth: its edit
/// response carries the authoritative `requeued` flag (/CLAUDE.md — never trust
/// the client). A change re-queues when:
///   - an ADDRESS field changes (fullAddress / pincode / latitude / longitude), or
///   - a room's monthly rent changes by MORE than 20%.
library;

/// Address fields whose change re-queues a listing for re-approval.
const addressFields = <String>['fullAddress', 'pincode', 'latitude', 'longitude'];

/// A rent change strictly greater than this fraction re-queues for approval.
const rentRequeueThreshold = 0.2;

/// Would editing any of [changedFields] re-queue the listing? True iff an address
/// field is among them.
bool listingEditRequeues(Iterable<String> changedFields) =>
    changedFields.any(addressFields.contains);

/// Does a monthly-rent move exceed the 20% re-queue threshold? A move OFF zero
/// (an unpriced room becoming priced) is always significant; otherwise it is the
/// relative delta against the old rent. Mirrors `isRentChangeSignificant`.
bool isRentChangeSignificant(int beforePaise, int afterPaise) {
  if (beforePaise <= 0) return afterPaise > 0;
  return (afterPaise - beforePaise).abs() / beforePaise > rentRequeueThreshold;
}
