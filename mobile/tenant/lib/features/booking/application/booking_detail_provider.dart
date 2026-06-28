import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/booking_repository.dart';
import '../domain/booking.dart';

/// One booking for the detail screen (status + payment history). Masked/private
/// per status by the server (the app only renders what it receives).
final bookingByIdProvider =
    FutureProvider.autoDispose.family<Booking, String>((ref, id) => ref.read(bookingRepositoryProvider).fetchStatus(id));
