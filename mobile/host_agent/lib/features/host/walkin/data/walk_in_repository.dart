import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/walk_in_tenant.dart';

/// Walk-in entry + roster of walk-ins for a listing. Creating one BLOCKS a bed and
/// fires the app-invite SMS server-side; the typed Aadhaar number is stored only
/// for the host's record and never returned in full. Payment mode is recorded,
/// never processed in-app.
class WalkInRepository {
  final Dio _dio;
  WalkInRepository(this._dio);

  Future<WalkInPage> list(String listingId, {bool includeCheckedOut = false, String? cursor, int limit = 30}) async {
    final res = await _dio.get<dynamic>(
      '/v1/host/listings/$listingId/walk-ins',
      queryParameters: {
        'limit': limit,
        if (includeCheckedOut) 'includeCheckedOut': 'true',
        if (cursor != null) 'cursor': cursor,
      },
    );
    final data = res.data as Map<String, dynamic>;
    return WalkInPage(
      items: (data['items'] as List<dynamic>)
          .map((e) => WalkInTenant.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<WalkInTenant> create(String listingId, Map<String, dynamic> body) async {
    final res = await _dio.post<dynamic>('/v1/host/listings/$listingId/walk-ins', data: body);
    return WalkInTenant.fromJson((res.data as Map<String, dynamic>)['walkIn'] as Map<String, dynamic>);
  }

  Future<WalkInTenant> checkout(String walkInId) async {
    final res = await _dio.post<dynamic>('/v1/host/walk-ins/$walkInId/checkout');
    return WalkInTenant.fromJson((res.data as Map<String, dynamic>)['walkIn'] as Map<String, dynamic>);
  }
}

final walkInRepositoryProvider =
    Provider<WalkInRepository>((ref) => WalkInRepository(ref.read(dioProvider)));
