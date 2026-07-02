import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../common/agent_async.dart';
import '../../common/offline_controller.dart';
import '../../dashboard/application/dashboard_controller.dart';
import '../data/agent_visit_repository.dart';
import '../domain/agent_visit.dart';

/// One visit's detail, offline-tolerant. When the live fetch fails offline it
/// serves the last-synced copy — either this controller's own last fetch, or, on
/// a cold open with no fetch yet, the copy the dashboard already cached for
/// today's queue. Non-autoDispose so the snapshot survives the session.
class VisitDetailController extends OfflineController<AgentVisit> {
  VisitDetailController(this._repo, this._visitId, this._seed);

  final AgentVisitRepository _repo;
  final String _visitId;
  final AgentVisit? Function() _seed;

  @override
  Future<AgentVisit> fetch() => _repo.detail(_visitId);

  @override
  AgentVisit? seedFromCache() => _seed();
}

final visitDetailControllerProvider =
    StateNotifierProvider.family<VisitDetailController, OfflineState<AgentVisit>, String>((ref, visitId) {
  final controller = VisitDetailController(
    ref.read(agentVisitRepositoryProvider),
    visitId,
    () => _cachedTodaysVisit(ref, visitId),
  );
  controller.load();
  return controller;
});

/// The visit as the dashboard last cached it for today's queue (or null).
AgentVisit? _cachedTodaysVisit(Ref ref, String visitId) {
  final dash = ref.read(agentDashboardControllerProvider).data;
  if (dash == null) return null;
  for (final v in dash.todaysVisits) {
    if (v.id == visitId) return v;
  }
  return null;
}

/// The full visits feed (all statuses), cursor-paginated. Read-only list view;
/// the dashboard already surfaces *today's* queue.
final agentVisitsProvider = FutureProvider.autoDispose.family<AgentVisitPage, String?>(
  (ref, status) => ref.read(agentVisitRepositoryProvider).list(status: status),
);
