import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import 'agent_async.dart';

/// A [StateNotifier] that keeps the last-synced value and serves it behind an
/// offline banner when the live fetch fails offline — agents work inside buildings
/// with weak signal, so a dropped request must not blank the screen. A real server
/// error (a response came back) still surfaces as an error when there is nothing
/// cached to show. Concrete controllers implement [fetch]; the provider calls
/// [load] once after construction (so tests can drive it deterministically).
abstract class OfflineController<T> extends StateNotifier<OfflineState<T>> {
  OfflineController() : super(const OfflineState(loading: true));

  /// Fetch fresh data from the network. Throws on failure.
  Future<T> fetch();

  /// Optional cross-feature seed (e.g. a visit already cached by the dashboard).
  /// Consulted only when this controller has never fetched successfully.
  T? seedFromCache() => null;

  /// (Re)load. On success shows fresh data; on an offline failure falls back to
  /// the last-synced value (or a cross-feature seed) behind a banner; only with
  /// nothing to show does it surface an error. Never throws.
  Future<void> load() async {
    if (!mounted) return;
    state = OfflineState<T>(data: state.data, loading: true, fromCache: state.fromCache);
    try {
      final data = await fetch();
      if (!mounted) return;
      state = OfflineState<T>(data: data);
    } catch (e) {
      if (!mounted) return;
      final offline = isOfflineError(e);
      final cached = state.data ?? seedFromCache();
      if (cached != null) {
        // Keep showing data; flag it stale only when we're genuinely offline.
        state = OfflineState<T>(data: cached, fromCache: offline);
      } else {
        state = OfflineState<T>(error: apiExceptionFrom(e).message);
      }
    }
  }

  Future<void> refresh() => load();
}
