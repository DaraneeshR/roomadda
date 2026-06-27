import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';
import '../domain/booking.dart';

class BookingRepository {
  final Dio _dio;
  BookingRepository(this._dio);

  Future<Booking> createHold(String bedId) async {
    final res = await _dio.post<dynamic>('/v1/bookings', data: {'bedId': bedId});
    return Booking.fromJson((res.data as Map<String, dynamic>)['booking'] as Map<String, dynamic>);
  }

  Future<RazorpayOrder> createOnlinePayment(String bookingId, int tokenPaise) async {
    final res = await _dio.post<dynamic>(
      '/v1/bookings/$bookingId/payment',
      data: {'method': 'ONLINE', 'onlinePaise': tokenPaise, 'cashPaise': 0},
    );
    return RazorpayOrder.fromJson((res.data as Map<String, dynamic>)['razorpayOrder'] as Map<String, dynamic>);
  }

  /// The ONLY source of truth for booking status. The server confirms via the
  /// Razorpay webhook; the app never decides CONFIRMED itself. Backed by the
  /// tenant-scoped GET /v1/bookings/:id (a foreign booking id returns 404).
  Future<Booking> fetchStatus(String bookingId) async {
    final res = await _dio.get<dynamic>('/v1/bookings/$bookingId');
    return Booking.fromJson((res.data as Map<String, dynamic>)['booking'] as Map<String, dynamic>);
  }

  /// The caller's own bookings, newest first. Cursor-paginated and masked/private
  /// per status by the server. Backed by the tenant-scoped GET /v1/bookings.
  Future<BookingPage> listMine({String? cursor, int limit = 20}) async {
    final res = await _dio.get<dynamic>(
      '/v1/bookings',
      queryParameters: {'limit': limit, if (cursor != null) 'cursor': cursor},
    );
    final data = res.data as Map<String, dynamic>;
    return BookingPage(
      items: (data['items'] as List<dynamic>)
          .map((e) => Booking.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }
}

final bookingRepositoryProvider = Provider<BookingRepository>((ref) => BookingRepository(ref.read(dioProvider)));
