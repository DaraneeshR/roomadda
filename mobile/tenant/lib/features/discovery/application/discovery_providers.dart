import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/listing_repository.dart';
import '../domain/listing.dart';

/// A single masked listing for the detail screen.
final listingDetailProvider = FutureProvider.autoDispose
    .family<PublicListing, String>((ref, id) => ref.read(listingRepositoryProvider).detail(id));

/// Geo query for the nearby map. A record key so the family memoises per area.
typedef NearbyQuery = ({double lat, double lng, int radiusM});

/// Nearby listings (with distanceMeters) for the map view.
final nearbyProvider = FutureProvider.autoDispose.family<List<PublicListing>, NearbyQuery>(
  (ref, q) => ref.read(listingRepositoryProvider).nearby(lat: q.lat, lng: q.lng, radiusM: q.radiusM),
);
