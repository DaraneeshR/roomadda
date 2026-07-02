import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/agent_visit.dart';

/// The agent's visits (zone-scoped server-side; a cross-zone id is a 404). Every
/// call goes through the core dio (auth + error interceptors). The GPS check-in is
/// validated server-side (ST_DWithin <=200m) — this only reports the device fix.
class AgentVisitRepository {
  final Dio _dio;
  AgentVisitRepository(this._dio);

  Future<AgentVisitPage> list({String? status, String? cursor, int limit = 30}) async {
    final res = await _dio.get<dynamic>(
      '/v1/agent/visits',
      queryParameters: {
        'limit': limit,
        if (status != null) 'status': status,
        if (cursor != null) 'cursor': cursor,
      },
    );
    final data = res.data as Map<String, dynamic>;
    return AgentVisitPage(
      items: (data['items'] as List<dynamic>)
          .map((e) => AgentVisit.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<AgentVisit> detail(String visitId) async {
    final res = await _dio.get<dynamic>('/v1/agent/visits/$visitId');
    return AgentVisit.fromJson((res.data as Map<String, dynamic>)['visit'] as Map<String, dynamic>);
  }

  /// Record a GPS check-in. The server validates the point against the property
  /// geography; the returned `withinRange` is authoritative (the app never decides
  /// it). An out-of-range point is still recorded as the "cannot reach" flag path.
  Future<CheckInResult> checkIn(String visitId, {required double lat, required double lng, double? accuracyMeters}) async {
    final res = await _dio.post<dynamic>(
      '/v1/agent/visits/$visitId/check-in',
      data: {
        'lat': lat,
        'lng': lng,
        if (accuracyMeters != null) 'accuracyMeters': accuracyMeters,
      },
    );
    return CheckInResult.fromJson(res.data as Map<String, dynamic>);
  }
}

final agentVisitRepositoryProvider =
    Provider<AgentVisitRepository>((ref) => AgentVisitRepository(ref.read(dioProvider)));
