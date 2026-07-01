import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/host_listing_repository.dart';
import '../domain/host_listing.dart';

/// The host's own listings (live / draft / paused). Invalidate to refresh after a
/// publish / pause / edit.
final hostListingsProvider = FutureProvider.autoDispose<HostListingPage>(
  (ref) => ref.read(hostListingRepositoryProvider).list(limit: 50),
);

/// One listing's full host view (unmasked + per-room inventory). Re-fetched on
/// demand; inventory + booking screens watch this so a verify/adjust shows live.
final hostListingProvider = FutureProvider.autoDispose.family<HostListing, String>(
  (ref, id) => ref.read(hostListingRepositoryProvider).detail(id),
);

/// A listing's edit history (newest first).
final listingEditHistoryProvider = FutureProvider.autoDispose.family<List<ListingEditLogItem>, String>(
  (ref, id) => ref.read(hostListingRepositoryProvider).editHistory(id),
);
