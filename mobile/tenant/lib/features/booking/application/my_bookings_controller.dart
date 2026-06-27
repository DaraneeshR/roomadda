import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:roomadda_core/roomadda_core.dart';
import '../data/booking_repository.dart';
import '../domain/booking.dart';

/// Immutable view state for the tenant's "My bookings" list.
class MyBookingsState {
  final List<Booking> items;
  final String? nextCursor;
  final bool isLoading;
  final bool isLoadingMore;
  final String? error;

  const MyBookingsState({
    this.items = const [],
    this.nextCursor,
    this.isLoading = false,
    this.isLoadingMore = false,
    this.error,
  });

  bool get hasMore => nextCursor != null;
  bool get isEmpty => items.isEmpty;
}

/// Loads the caller's bookings from `GET /v1/bookings` (cursor-paginated). The
/// server masks/unmasks each listing per booking status, so this layer only ever
/// renders what it receives — it never decides masking itself.
class MyBookingsController extends StateNotifier<MyBookingsState> {
  MyBookingsController(this._repo) : super(const MyBookingsState(isLoading: true)) {
    refresh();
  }

  final BookingRepository _repo;

  /// (Re)load the first page.
  Future<void> refresh() async {
    state = MyBookingsState(items: state.items, nextCursor: state.nextCursor, isLoading: true);
    try {
      final page = await _repo.listMine();
      state = MyBookingsState(items: page.items, nextCursor: page.nextCursor);
    } catch (e) {
      state = MyBookingsState(
        items: state.items,
        nextCursor: state.nextCursor,
        error: apiExceptionFrom(e).message,
      );
    }
  }

  /// Append the next page, if any. A failure surfaces an error, never a crash.
  Future<void> loadMore() async {
    if (state.isLoadingMore || !state.hasMore) return;
    state = MyBookingsState(
      items: state.items,
      nextCursor: state.nextCursor,
      isLoadingMore: true,
    );
    try {
      final page = await _repo.listMine(cursor: state.nextCursor);
      state = MyBookingsState(
        items: [...state.items, ...page.items],
        nextCursor: page.nextCursor,
      );
    } catch (e) {
      state = MyBookingsState(
        items: state.items,
        nextCursor: state.nextCursor,
        error: apiExceptionFrom(e).message,
      );
    }
  }
}

final myBookingsControllerProvider =
    StateNotifierProvider.autoDispose<MyBookingsController, MyBookingsState>(
  (ref) => MyBookingsController(ref.read(bookingRepositoryProvider)),
);
