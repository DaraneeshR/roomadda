import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/agent_location.dart';
import '../data/agent_visit_repository.dart';
import '../domain/agent_visit.dart';
import 'visit_providers.dart';

/// Where the "Start Visit" GPS check-in currently is. The server owns the
/// within-range verdict; this only sequences capture → submit → result and never
/// decides validity on-device.
sealed class CheckInPhase {
  const CheckInPhase();
}

/// Nothing started yet.
class CheckInIdle extends CheckInPhase {
  const CheckInIdle();
}

/// Acquiring the device GPS fix.
class CheckInLocating extends CheckInPhase {
  const CheckInLocating();
}

/// Posting the fix to the server for the ST_DWithin verdict.
class CheckInSubmitting extends CheckInPhase {
  const CheckInSubmitting();
}

/// The server responded. [result].withinRange is authoritative; when false this is
/// the "cannot reach property" flag path (recorded, surfaced, inspection stays
/// locked).
class CheckInDone extends CheckInPhase {
  final CheckInResult result;
  const CheckInDone(this.result);
}

/// Location could not be captured (permission/service/timeout) — handled
/// gracefully with an actionable message, never a crash.
class CheckInLocationBlocked extends CheckInPhase {
  final LocationFailure failure;
  const CheckInLocationBlocked(this.failure);
}

/// The submit call failed (network/server) — offer a retry.
class CheckInFailed extends CheckInPhase {
  final String message;
  const CheckInFailed(this.message);
}

/// Drives one visit's GPS check-in. On success it invokes [onCheckedIn] so the
/// visit detail re-fetches and the inspection unlocks (only if within range).
class CheckInController extends StateNotifier<CheckInPhase> {
  CheckInController(this._location, this._repo, this._visitId, this._onCheckedIn)
      : super(const CheckInIdle());

  final LocationService _location;
  final AgentVisitRepository _repo;
  final String _visitId;
  final Future<void> Function() _onCheckedIn;

  bool _busy = false;

  Future<void> start() async {
    if (_busy) return;
    _busy = true;
    try {
      state = const CheckInLocating();
      final loc = await _location.current();
      if (!loc.ok) {
        state = CheckInLocationBlocked(loc.failure!);
        return;
      }
      state = const CheckInSubmitting();
      final pos = loc.position!;
      final result = await _repo.checkIn(
        _visitId,
        lat: pos.latitude,
        lng: pos.longitude,
        accuracyMeters: pos.accuracy,
      );
      state = CheckInDone(result);
      await _onCheckedIn();
    } catch (e) {
      state = CheckInFailed(apiExceptionFrom(e).message);
    } finally {
      _busy = false;
    }
  }

  void reset() => state = const CheckInIdle();
}

final checkInControllerProvider =
    StateNotifierProvider.autoDispose.family<CheckInController, CheckInPhase, String>((ref, visitId) {
  return CheckInController(
    ref.read(locationServiceProvider),
    ref.read(agentVisitRepositoryProvider),
    visitId,
    // On a recorded check-in, re-fetch the visit so the inspection lock re-evaluates
    // against the server's within-range verdict (never the on-device fix).
    () => ref.read(visitDetailControllerProvider(visitId).notifier).refresh(),
  );
});
