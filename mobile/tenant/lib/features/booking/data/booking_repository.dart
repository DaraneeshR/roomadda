import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';
import '../domain/booking.dart';

/// Outcome of a cancellation: the new status + the refund the policy awarded.
class CancelResult {
  final String status;
  final Paise refund;
  const CancelResult({required this.status, required this.refund});
}

class BookingRepository {
  final Dio _dio;
  BookingRepository(this._dio);

  /// Place a hold by ROOM — the server picks an available bed (discovery is
  /// masked and never exposes bed ids). Returns the booking; its status is
  /// TOKEN_PENDING (Instant Book) or PENDING_APPROVAL (Request-to-Book).
  Future<Booking> createHoldForRoom(String roomId, {DateTime? moveInDate, String? mealPlan}) async {
    final res = await _dio.post<dynamic>('/v1/bookings', data: {
      'roomId': roomId,
      if (moveInDate != null) 'moveInDate': moveInDate.toIso8601String(),
      if (mealPlan != null) 'mealPlan': mealPlan,
    });
    return Booking.fromJson((res.data as Map<String, dynamic>)['booking'] as Map<String, dynamic>);
  }

  /// Place a hold on a specific bed (used where a bed id is known).
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

  /// Cancel a booking; the server applies the refund policy and returns the refund.
  Future<CancelResult> cancel(String bookingId, {String? reason}) async {
    final res = await _dio.post<dynamic>(
      '/v1/bookings/$bookingId/cancel',
      data: {if (reason != null) 'reason': reason},
    );
    final d = res.data as Map<String, dynamic>;
    return CancelResult(status: d['status'] as String, refund: Paise((d['refundPaise'] as num).toInt()));
  }

  /// Download the confirmed-booking PDF receipt bytes (auth via the core dio).
  Future<Uint8List> downloadReceipt(String bookingId) async {
    final res = await _dio.get<List<int>>(
      '/v1/bookings/$bookingId/receipt',
      options: Options(responseType: ResponseType.bytes),
    );
    return Uint8List.fromList(res.data ?? const []);
  }
}

final bookingRepositoryProvider = Provider<BookingRepository>((ref) => BookingRepository(ref.read(dioProvider)));
