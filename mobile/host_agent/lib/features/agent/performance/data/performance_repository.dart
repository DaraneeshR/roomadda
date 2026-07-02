import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/agent_performance.dart';

/// Reads `GET /v1/agent/performance` (this month's read-only scorecard).
class PerformanceRepository {
  final Dio _dio;
  PerformanceRepository(this._dio);

  Future<AgentPerformance> fetch() async {
    final res = await _dio.get<dynamic>('/v1/agent/performance');
    return AgentPerformance.fromJson(res.data as Map<String, dynamic>);
  }
}

final performanceRepositoryProvider =
    Provider<PerformanceRepository>((ref) => PerformanceRepository(ref.read(dioProvider)));
