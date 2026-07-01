import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../booking/domain/booking.dart' show RazorpayOrder;
import '../domain/rent_invoice.dart';

/// Talks to the tenant rent endpoints. Status is SERVER-OWNED: the app reads
/// it and polls `GET /v1/rent/:id` to observe the webhook-driven DUE -> PAID,
/// exactly like the token flow. It never decides PAID itself (see /CLAUDE.md).
class RentRepository {
  final Dio _dio;
  RentRepository(this._dio);

  /// The caller's rent history, newest due first. Cursor-paginated by the server.
  Future<RentPage> listMine({String? cursor, int limit = 20}) async {
    final res = await _dio.get<dynamic>(
      '/v1/rent',
      queryParameters: {'limit': limit, if (cursor != null) 'cursor': cursor},
    );
    final data = res.data as Map<String, dynamic>;
    return RentPage(
      items: (data['items'] as List<dynamic>)
          .map((e) => RentInvoice.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  /// One invoice — the source of truth the payment screen polls for PAID.
  Future<RentInvoice> fetchInvoice(String invoiceId) async {
    final res = await _dio.get<dynamic>('/v1/rent/$invoiceId');
    return RentInvoice.fromJson((res.data as Map<String, dynamic>)['invoice'] as Map<String, dynamic>);
  }

  /// Initiate a FULL-amount rent payment — the server returns a Razorpay order.
  /// There is no amount argument: a partial payment cannot be requested.
  Future<RazorpayOrder> payRent(String invoiceId) async {
    final res = await _dio.post<dynamic>('/v1/rent/$invoiceId/pay');
    return RazorpayOrder.fromJson((res.data as Map<String, dynamic>)['razorpayOrder'] as Map<String, dynamic>);
  }

  /// Download the paid-rent PDF receipt bytes (available once PAID).
  Future<Uint8List> downloadReceipt(String invoiceId) async {
    final res = await _dio.get<List<int>>(
      '/v1/rent/$invoiceId/receipt',
      options: Options(responseType: ResponseType.bytes),
    );
    return Uint8List.fromList(res.data ?? const []);
  }
}

final rentRepositoryProvider = Provider<RentRepository>((ref) => RentRepository(ref.read(dioProvider)));
