import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../common/agent_async.dart';
import '../../common/offline_controller.dart';
import '../data/agent_dashboard_repository.dart';
import '../domain/agent_dashboard.dart';

/// The agent home controller. Extends [OfflineController]: on a successful fetch it
/// shows fresh data; when the live fetch fails offline it keeps serving the
/// last-synced dashboard behind a banner (agents work in weak-signal buildings).
class AgentDashboardController extends OfflineController<AgentDashboard> {
  AgentDashboardController(this._repo);

  final AgentDashboardRepository _repo;

  @override
  Future<AgentDashboard> fetch() => _repo.fetch();
}

/// Non-autoDispose so the last-synced snapshot survives tab switches and transient
/// signal drops across the agent's working session. The provider kicks off the
/// first load; tests construct the controller directly and drive `load()`.
final agentDashboardControllerProvider =
    StateNotifierProvider<AgentDashboardController, OfflineState<AgentDashboard>>((ref) {
  final controller = AgentDashboardController(ref.read(agentDashboardRepositoryProvider));
  controller.load();
  return controller;
});
