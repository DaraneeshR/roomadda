import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/agent_erp_home.dart';

/// Reads `GET /v1/agent/erp/home` (§15.4) — the agent's own scoped month snapshot.
/// The endpoint is self + zone scoped server-side; this client never sees another
/// agent's data nor any company-finance figure.
class AgentErpRepository {
  final Dio _dio;
  AgentErpRepository(this._dio);

  Future<AgentErpHome> fetchHome() async {
    final res = await _dio.get<dynamic>('/v1/agent/erp/home');
    return AgentErpHome.fromJson(res.data as Map<String, dynamic>);
  }
}

final agentErpRepositoryProvider =
    Provider<AgentErpRepository>((ref) => AgentErpRepository(ref.read(dioProvider)));
