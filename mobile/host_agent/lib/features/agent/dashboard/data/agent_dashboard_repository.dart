import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/agent_dashboard.dart';

/// Reads `GET /v1/agent/dashboard` (today's visits + actionable counts). Zone-
/// scoping is enforced server-side. Offline tolerance (serving last-synced data)
/// lives in the controller, not here — this just fetches.
class AgentDashboardRepository {
  final Dio _dio;
  AgentDashboardRepository(this._dio);

  Future<AgentDashboard> fetch() async {
    final res = await _dio.get<dynamic>('/v1/agent/dashboard');
    return AgentDashboard.fromJson(res.data as Map<String, dynamic>);
  }
}

final agentDashboardRepositoryProvider =
    Provider<AgentDashboardRepository>((ref) => AgentDashboardRepository(ref.read(dioProvider)));
