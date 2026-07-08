import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/hotel.dart';

/// Talks to the B2C hotel endpoints (`/v1/hotels/*`) through the core dio (base
/// URL + auth/refresh + error interceptors). Every price/date/availability field
/// it returns is the SERVER-OWNED snapshot — this layer never computes money.
class HotelRepository {
  final Dio _dio;
  HotelRepository(this._dio);

  /// Date-only (`yyyy-mm-dd`) as the search/hold endpoints expect (the server
  /// coerces + re-echoes it). A half-open [checkIn, checkOut) stay range.
  static String isoDate(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// Masked availability search — `GET /v1/hotels/search`. Returns HOTEL listings
  /// (server-filtered to B2C-visible) with a per-night price + real free-room count
  /// for the range. Public/masked; browsing never requires auth (just-in-time KYC).
  Future<HotelSearchResponse> search({
    required String city,
    String? area,
    required DateTime checkIn,
    required DateTime checkOut,
    int guests = 1,
    String? cursor,
    int limit = 24,
  }) async {
    final res = await _dio.get<dynamic>('/v1/hotels/search', queryParameters: {
      'city': city,
      if (area != null && area.isNotEmpty) 'area': area,
      'checkIn': isoDate(checkIn),
      'checkOut': isoDate(checkOut),
      'guests': '$guests',
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
    });
    return HotelSearchResponse.fromJson(res.data as Map<String, dynamic>);
  }

  /// Hold a room in a category for the range — `POST /v1/hotels/reservations`.
  /// Sends ONLY { categoryId, dates, guests }; the server snapshots the price and
  /// the token (no price field is accepted). Returns the HELD reservation.
  Future<HotelReservation> createHold({
    required String categoryId,
    required DateTime checkIn,
    required DateTime checkOut,
    int guests = 1,
  }) async {
    final res = await _dio.post<dynamic>('/v1/hotels/reservations', data: {
      'categoryId': categoryId,
      'checkIn': isoDate(checkIn),
      'checkOut': isoDate(checkOut),
      'guests': guests,
    });
    return HotelReservation.fromJson((res.data as Map<String, dynamic>)['reservation'] as Map<String, dynamic>);
  }

  /// Initiate the securing payment — `POST /v1/hotels/reservations/:id/payment`.
  /// The server owns the amount (full-stay prepay); no body is sent.
  Future<HotelPaymentOrder> createPayment(String reservationId) async {
    final res = await _dio.post<dynamic>('/v1/hotels/reservations/$reservationId/payment');
    return HotelPaymentOrder.fromJson(res.data as Map<String, dynamic>);
  }

  /// The ONLY source of truth for reservation status — `GET /v1/hotels/reservations/:id`
  /// (tenant-scoped; a foreign id returns 404). The confirmation poll reads this to
  /// observe the webhook-driven transition to CONFIRMED. The app never self-confirms.
  Future<HotelReservation> fetchStatus(String reservationId) async {
    final res = await _dio.get<dynamic>('/v1/hotels/reservations/$reservationId');
    return HotelReservation.fromJson((res.data as Map<String, dynamic>)['reservation'] as Map<String, dynamic>);
  }

  /// Cancel a reservation — `POST /v1/hotels/reservations/:id/cancel`. The server
  /// applies the refund policy and INITIATES the refund; it settles via the webhook,
  /// so the result reports the refund as pending.
  Future<HotelCancelResult> cancel(String reservationId, {String? reason}) async {
    final res = await _dio.post<dynamic>(
      '/v1/hotels/reservations/$reservationId/cancel',
      data: {if (reason != null) 'reason': reason},
    );
    return HotelCancelResult.fromJson(res.data as Map<String, dynamic>);
  }

  /// Download the confirmed-reservation PDF receipt bytes — `GET .../receipt`.
  Future<Uint8List> downloadReceipt(String reservationId) async {
    final res = await _dio.get<List<int>>(
      '/v1/hotels/reservations/$reservationId/receipt',
      options: Options(responseType: ResponseType.bytes),
    );
    return Uint8List.fromList(res.data ?? const []);
  }
}

final hotelRepositoryProvider =
    Provider<HotelRepository>((ref) => HotelRepository(ref.read(dioProvider)));
