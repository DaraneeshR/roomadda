import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../discovery/domain/listing.dart';
import '../data/wishlist_repository.dart';

/// Saved-listings state. `savedIds` drives the heart toggle on cards/detail
/// across the app; `items` backs the Saved tab.
class WishlistState {
  final List<PublicListing> items;
  final Set<String> savedIds;
  final bool loading;
  final String? error;

  const WishlistState({
    this.items = const [],
    this.savedIds = const {},
    this.loading = false,
    this.error,
  });

  bool get isEmpty => items.isEmpty;

  WishlistState copyWith({
    List<PublicListing>? items,
    Set<String>? savedIds,
    bool? loading,
    Object? error = _unset,
  }) {
    return WishlistState(
      items: items ?? this.items,
      savedIds: savedIds ?? this.savedIds,
      loading: loading ?? this.loading,
      error: error == _unset ? this.error : error as String?,
    );
  }

  static const Object _unset = Object();
}

class WishlistController extends StateNotifier<WishlistState> {
  WishlistController(this._repo) : super(const WishlistState(loading: true)) {
    load();
  }

  final WishlistRepository _repo;

  bool isSaved(String listingId) => state.savedIds.contains(listingId);

  Future<void> load() async {
    state = state.copyWith(loading: true, error: null);
    try {
      final items = await _repo.list();
      state = state.copyWith(items: items, savedIds: items.map((l) => l.id).toSet(), loading: false);
    } catch (e) {
      state = state.copyWith(loading: false, error: apiExceptionFrom(e).message);
    }
  }

  /// Save/unsave with an optimistic update; on failure we revert and surface the
  /// error (never a crash, see /CLAUDE.md reliability).
  Future<void> toggle(PublicListing listing) async {
    final wasSaved = state.savedIds.contains(listing.id);
    final prev = state;

    if (wasSaved) {
      state = state.copyWith(
        savedIds: {...state.savedIds}..remove(listing.id),
        items: state.items.where((l) => l.id != listing.id).toList(),
        error: null,
      );
      try {
        await _repo.remove(listing.id);
      } catch (e) {
        state = prev.copyWith(error: apiExceptionFrom(e).message);
      }
    } else {
      state = state.copyWith(savedIds: {...state.savedIds, listing.id}, error: null);
      try {
        await _repo.add(listing.id);
        await load(); // refresh to pull the canonical saved item (live rent/availability)
      } catch (e) {
        state = prev.copyWith(error: apiExceptionFrom(e).message);
      }
    }
  }
}

final wishlistControllerProvider =
    StateNotifierProvider<WishlistController, WishlistState>((ref) => WishlistController(ref.read(wishlistRepositoryProvider)));
