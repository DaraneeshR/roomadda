import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/hotel_repository.dart';
import '../domain/hotel.dart';

/// An availability search: a city (+ optional area) over a half-open date range
/// for a party size. Value-equal so the [hotelSearchProvider] family memoises a
/// given search (and the results survive a rebuild) instead of re-fetching.
class HotelSearchQuery {
  final String city;
  final String? area;
  final DateTime checkIn;
  final DateTime checkOut;
  final int guests;

  const HotelSearchQuery({
    required this.city,
    this.area,
    required this.checkIn,
    required this.checkOut,
    this.guests = 1,
  });

  @override
  bool operator ==(Object other) =>
      other is HotelSearchQuery &&
      other.city == city &&
      other.area == area &&
      other.checkIn == checkIn &&
      other.checkOut == checkOut &&
      other.guests == guests;

  @override
  int get hashCode => Object.hash(city, area, checkIn, checkOut, guests);
}

/// The current search on the Hotels tab (null until the guest searches). Held so
/// the form + results share one source of truth without prop-drilling.
final hotelSearchQueryProvider = StateProvider.autoDispose<HotelSearchQuery?>((ref) => null);

/// Runs an availability search. Price + availability are 100% server-owned; this
/// only decodes the response. Keyed by the value-equal query so results are cached.
final hotelSearchProvider =
    FutureProvider.autoDispose.family<HotelSearchResponse, HotelSearchQuery>((ref, q) {
  return ref.read(hotelRepositoryProvider).search(
        city: q.city,
        area: q.area,
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        guests: q.guests,
      );
});
