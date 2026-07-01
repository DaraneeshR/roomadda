import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/booking_request_repository.dart';
import '../domain/host_booking_request.dart';

/// Incoming bookings across the host's listings — pending Request-to-Book holds
/// (actionable, with a 24h countdown) plus confirmed instant bookings. Invalidate
/// after accept/decline to refresh.
final bookingRequestsProvider = FutureProvider.autoDispose<HostBookingRequestPage>(
  (ref) => ref.read(bookingRequestRepositoryProvider).list(limit: 50),
);
