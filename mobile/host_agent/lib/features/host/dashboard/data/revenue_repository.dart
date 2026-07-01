import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/revenue_summary.dart';

/// Read-only revenue snapshot for one listing (`GET /host/listings/:id/revenue`).
class RevenueRepository {
  final Dio _dio;
  RevenueRepository(this._dio);

  Future<RevenueSummary> summary(String listingId) async {
    final res = await _dio.get<dynamic>('/v1/host/listings/$listingId/revenue');
    return RevenueSummary.fromJson(res.data as Map<String, dynamic>);
  }
}

final revenueRepositoryProvider =
    Provider<RevenueRepository>((ref) => RevenueRepository(ref.read(dioProvider)));
