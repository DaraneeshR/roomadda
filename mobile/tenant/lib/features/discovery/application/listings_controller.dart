import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/listing_repository.dart';
import '../domain/filters.dart';
import '../domain/listing.dart';

/// Results state for the browse list. App-scoped (not autoDispose) so the result
/// set survives Home → Results → Detail → back.
class ListingsState {
  final List<PublicListing> items;
  final ListingFilters filters;

  /// The searched place (for the results header) + its coarse geo, used to seed
  /// the map view. Null for a free-text or unscoped search.
  final String? placeLabel;
  final GeoPoint? geo;

  final bool loading;
  final bool loadingMore;
  final String? error;
  final String? nextCursor;

  /// True once a search has been run (so the empty list reads "no matches",
  /// not the pristine "search for a PG" state).
  final bool hasSearched;

  const ListingsState({
    this.items = const [],
    this.filters = const ListingFilters(),
    this.placeLabel,
    this.geo,
    this.loading = false,
    this.loadingMore = false,
    this.error,
    this.nextCursor,
    this.hasSearched = false,
  });

  bool get hasMore => nextCursor != null;
  bool get isEmpty => items.isEmpty;

  ListingsState copyWith({
    List<PublicListing>? items,
    ListingFilters? filters,
    Object? placeLabel = _unset,
    Object? geo = _unset,
    bool? loading,
    bool? loadingMore,
    Object? error = _unset,
    Object? nextCursor = _unset,
    bool? hasSearched,
  }) {
    return ListingsState(
      items: items ?? this.items,
      filters: filters ?? this.filters,
      placeLabel: placeLabel == _unset ? this.placeLabel : placeLabel as String?,
      geo: geo == _unset ? this.geo : geo as GeoPoint?,
      loading: loading ?? this.loading,
      loadingMore: loadingMore ?? this.loadingMore,
      error: error == _unset ? this.error : error as String?,
      nextCursor: nextCursor == _unset ? this.nextCursor : nextCursor as String?,
      hasSearched: hasSearched ?? this.hasSearched,
    );
  }

  static const Object _unset = Object();
}

class ListingsController extends StateNotifier<ListingsState> {
  ListingsController(this._repo) : super(const ListingsState());

  final ListingRepository _repo;
  static const _pageSize = 15;

  /// Run a fresh search. Replaces filters/geo and reloads the first page.
  Future<void> search({ListingFilters? filters, GeoPoint? geo, String? placeLabel}) async {
    final f = filters ?? state.filters;
    state = state.copyWith(
      filters: f,
      geo: geo,
      placeLabel: placeLabel,
      loading: true,
      error: null,
      items: const [],
      nextCursor: null,
      hasSearched: true,
    );
    try {
      final page = await _repo.browse(f, limit: _pageSize);
      state = state.copyWith(items: page.items, nextCursor: page.nextCursor, loading: false);
    } catch (e) {
      state = state.copyWith(loading: false, error: apiExceptionFrom(e).message);
    }
  }

  /// Re-run with a changed filter set, keeping the current place/geo.
  Future<void> applyFilters(ListingFilters filters) =>
      search(filters: filters, geo: state.geo, placeLabel: state.placeLabel);

  /// Append the next page (infinite scroll). A failure surfaces an error, never a crash.
  Future<void> loadMore() async {
    if (state.loadingMore || !state.hasMore) return;
    state = state.copyWith(loadingMore: true, error: null);
    try {
      final page = await _repo.browse(state.filters, cursor: state.nextCursor, limit: _pageSize);
      state = state.copyWith(
        items: [...state.items, ...page.items],
        nextCursor: page.nextCursor,
        loadingMore: false,
      );
    } catch (e) {
      state = state.copyWith(loadingMore: false, error: apiExceptionFrom(e).message);
    }
  }
}

final listingsControllerProvider =
    StateNotifierProvider<ListingsController, ListingsState>((ref) => ListingsController(ref.read(listingRepositoryProvider)));
