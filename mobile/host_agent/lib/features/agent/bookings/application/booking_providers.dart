import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../visits/data/agent_visit_repository.dart';
import '../data/agent_booking_repository.dart';
import '../domain/booking_room.dart';
import 'walk_in_poller.dart';

/// A property the agent can convert a booking at. The agent has no "my listings"
/// endpoint, so the property list is derived from the agent's assigned visits
/// (deduped by listing) — all in-zone by construction.
class BookingProperty {
  final String listingId;
  final String actualName;
  final String areaLabel;

  const BookingProperty({required this.listingId, required this.actualName, required this.areaLabel});
}

/// Distinct properties from the agent's visits (any status), for the booking
/// property picker. Cursor page one is enough for the MVP volume.
final agentBookingPropertiesProvider = FutureProvider.autoDispose<List<BookingProperty>>((ref) async {
  final page = await ref.read(agentVisitRepositoryProvider).list(limit: 50);
  final seen = <String>{};
  final out = <BookingProperty>[];
  for (final v in page.items) {
    if (seen.add(v.listingId)) {
      out.add(BookingProperty(listingId: v.listingId, actualName: v.actualName, areaLabel: v.areaLabel));
    }
  }
  return out;
});

/// The bookable rooms of a chosen property (private detail; room ids + vacancy).
final agentBookingRoomsProvider =
    FutureProvider.autoDispose.family<List<BookingRoom>, String>((ref, listingId) {
  return ref.read(agentBookingRepositoryProvider).listingRooms(listingId);
});

/// Polls THIS walk-in booking to CONFIRMED, keyed by its [bookingId]. Each poll
/// reads the booking's OWN server status (GET /v1/agent/bookings/:id, webhook-
/// driven) fresh — so a confirmation reflects exactly this booking settling, never
/// an aggregate counter that any other in-scope confirmation would move, and never
/// a cached/local value. Confirmation is always server-truth.
final walkInPollerProvider =
    StateNotifierProvider.autoDispose.family<WalkInPoller, WalkInConfirmation, String>((ref, bookingId) {
  final repo = ref.read(agentBookingRepositoryProvider);
  final poller = WalkInPoller(() => repo.walkInStatus(bookingId));
  poller.start();
  return poller;
});
