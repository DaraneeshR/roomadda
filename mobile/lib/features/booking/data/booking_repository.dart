import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/providers.dart';
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
  /// Razorpay webhook; the app never decides CONFIRMED itself.
  ///
  /// NOTE: requires the backend to expose GET /v1/bookings/:id (tenant-scoped).
  Future<Booking> fetchStatus(String bookingId) async {
    final res = await _dio.get<dynamic>('/v1/bookings/$bookingId');
    return Booking.fromJson((res.data as Map<String, dynamic>)['booking'] as Map<String, dynamic>);
  }
}

final bookingRepositoryProvider = Provider<BookingRepository>((ref) => BookingRepository(ref.read(dioProvider)));
