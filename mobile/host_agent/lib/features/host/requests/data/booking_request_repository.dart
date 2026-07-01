import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/host_booking_request.dart';

/// Host incoming-bookings feed + accept/decline. Accept NEVER confirms a booking
/// (only the verified webhook does, /CLAUDE.md domain rule #2) — it unlocks the
/// tenant's payment. Decline initiates a full refund for the tenant. The feed
/// returns the tenant's display name only — NO KYC.
class BookingRequestRepository {
  final Dio _dio;
  BookingRequestRepository(this._dio);

  Future<HostBookingRequestPage> list({String? status, String? cursor, int limit = 30}) async {
    final res = await _dio.get<dynamic>(
      '/v1/host/booking-requests',
      queryParameters: {
        'limit': limit,
        if (status != null) 'status': status,
        if (cursor != null) 'cursor': cursor,
      },
    );
    final data = res.data as Map<String, dynamic>;
    return HostBookingRequestPage(
      items: (data['items'] as List<dynamic>)
          .map((e) => HostBookingRequest.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  /// Accept a Request-to-Book hold — unlocks payment for the tenant.
  Future<void> accept(String bookingId) async {
    await _dio.post<dynamic>('/v1/host/booking-requests/$bookingId/accept');
  }

  /// Decline / mark unavailable — a full refund is initiated for the tenant.
  Future<void> decline(String bookingId, {String? reason}) async {
    await _dio.post<dynamic>(
      '/v1/host/booking-requests/$bookingId/decline',
      data: {if (reason != null && reason.isNotEmpty) 'reason': reason},
    );
  }
}

final bookingRequestRepositoryProvider =
    Provider<BookingRequestRepository>((ref) => BookingRequestRepository(ref.read(dioProvider)));
