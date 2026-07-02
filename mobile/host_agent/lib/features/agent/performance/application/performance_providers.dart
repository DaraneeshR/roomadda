import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/performance_repository.dart';
import '../domain/agent_performance.dart';

/// This month's read-only scorecard. Re-fetched on demand (pull-to-refresh).
final agentPerformanceProvider =
    FutureProvider.autoDispose<AgentPerformance>((ref) => ref.read(performanceRepositoryProvider).fetch());
