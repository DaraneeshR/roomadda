import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/roster_tenant.dart';

/// Tenant roster for a listing — current (default) or past tenants. Each entry
/// carries NO KYC and NO other tenant's data; the host sees only name, room,
/// move-in and rent status (/CLAUDE.md domain rule #4). A per-listing roster is
/// bounded by inventory, so it returns as a single page.
class RosterRepository {
  final Dio _dio;
  RosterRepository(this._dio);

  Future<List<RosterTenant>> list(String listingId, {String scope = 'current'}) async {
    final res = await _dio.get<dynamic>(
      '/v1/host/listings/$listingId/roster',
      queryParameters: {'scope': scope},
    );
    return ((res.data as Map<String, dynamic>)['items'] as List<dynamic>)
        .map((e) => RosterTenant.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

final rosterRepositoryProvider =
    Provider<RosterRepository>((ref) => RosterRepository(ref.read(dioProvider)));
