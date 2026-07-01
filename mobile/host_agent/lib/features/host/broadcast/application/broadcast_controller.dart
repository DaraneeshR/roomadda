import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/broadcast_repository.dart';
import '../domain/broadcast.dart';

/// Broadcast compose state. [remainingToday] is null until we learn it (from a
/// successful send or a cap rejection); the UI then shows the live quota. The cap
/// is enforced server-side — this only mirrors it so the button disables once the
/// quota is exhausted, never letting the host fire a doomed request.
class BroadcastState {
  final bool sending;
  final int? remainingToday;
  final BroadcastResult? lastResult;
  final String? error;

  const BroadcastState({
    this.sending = false,
    this.remainingToday,
    this.lastResult,
    this.error,
  });

  /// Sends still allowed today; assume the full quota until we hear otherwise.
  int get remaining => remainingToday ?? broadcastDailyLimit;

  /// True when the daily quota is known to be exhausted.
  bool get capReached => remainingToday != null && remainingToday! <= 0;

  bool get canSend => !sending && !capReached;

  BroadcastState copyWith({
    bool? sending,
    int? remainingToday,
    BroadcastResult? lastResult,
    Object? error = _unset,
  }) =>
      BroadcastState(
        sending: sending ?? this.sending,
        remainingToday: remainingToday ?? this.remainingToday,
        lastResult: lastResult ?? this.lastResult,
        error: identical(error, _unset) ? this.error : error as String?,
      );
}

const _unset = Object();

class BroadcastController extends StateNotifier<BroadcastState> {
  BroadcastController(this._repo, this._listingId) : super(const BroadcastState());

  final BroadcastRepository _repo;
  final String _listingId;

  /// Send a broadcast. Returns true on success. On the cap rejection (429
  /// BROADCAST_LIMIT_REACHED) the quota is pinned to 0 so the button stays off.
  Future<bool> send(String body) async {
    if (!state.canSend) return false;
    state = state.copyWith(sending: true, error: null);
    try {
      final result = await _repo.send(_listingId, body);
      state = state.copyWith(
        sending: false,
        remainingToday: result.remainingToday,
        lastResult: result,
        error: null,
      );
      return true;
    } catch (e) {
      final api = apiExceptionFrom(e);
      state = state.copyWith(
        sending: false,
        remainingToday: api.code == 'BROADCAST_LIMIT_REACHED' ? 0 : null,
        error: api.message,
      );
      return false;
    }
  }
}

final broadcastControllerProvider =
    StateNotifierProvider.autoDispose.family<BroadcastController, BroadcastState, String>(
  (ref, listingId) => BroadcastController(ref.read(broadcastRepositoryProvider), listingId),
);
