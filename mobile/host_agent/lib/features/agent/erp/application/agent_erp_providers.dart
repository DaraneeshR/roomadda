import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/agent_erp_repository.dart';
import '../domain/agent_erp_home.dart';

/// The agent's scoped ERP month snapshot. Re-fetched on demand (pull-to-refresh).
final agentErpHomeProvider =
    FutureProvider.autoDispose<AgentErpHome>((ref) => ref.read(agentErpRepositoryProvider).fetchHome());
