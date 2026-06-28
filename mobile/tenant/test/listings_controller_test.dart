import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_core/roomadda_core.dart';
import 'package:roomadda_tenant/features/discovery/application/listings_controller.dart';
import 'package:roomadda_tenant/features/discovery/data/listing_repository.dart';
import 'package:roomadda_tenant/features/discovery/domain/filters.dart';
import 'package:roomadda_tenant/features/discovery/domain/listing.dart';

PublicListing _listing(String id, String gender) => PublicListing(
      id: id,
      alias: 'PG $id',
      areaLabel: 'Koramangala',
      city: 'Bengaluru',
      gender: gender,
      status: 'PUBLISHED',
      amenities: const ['WiFi'],
      priceFrom: const Paise(800000),
      instantBook: true,
      photos: const [],
      rooms: const [],
      approxLocation: const GeoPoint(12.93, 77.62),
      masked: true,
    );

/// Fake repo that records the filters it was asked for and filters its fixtures
/// by gender — enough to prove "results render" and "filters update results".
class _FakeListingRepo implements ListingRepository {
  ListingFilters? lastFilters;
  int browseCalls = 0;

  @override
  Future<ListingsPage> browse(ListingFilters filters, {String? cursor, int limit = 15}) async {
    browseCalls++;
    lastFilters = filters;
    final all = [_listing('a', 'MALE'), _listing('b', 'FEMALE')];
    final items = filters.gender == null ? all : all.where((l) => l.gender == filters.gender).toList();
    return ListingsPage(items: items, nextCursor: null);
  }

  @override
  Future<PublicListing> detail(String id) async => _listing(id, 'COED');

  @override
  Future<List<PublicListing>> nearby({
    required double lat,
    required double lng,
    required int radiusM,
    int limit = 30,
  }) async =>
      const [];
}

void main() {
  test('search renders results from the API', () async {
    final repo = _FakeListingRepo();
    final controller = ListingsController(repo);

    await controller.search(filters: const ListingFilters(area: 'Koramangala'));

    expect(controller.state.loading, isFalse);
    expect(controller.state.items.map((l) => l.id), ['a', 'b']);
    expect(repo.lastFilters?.area, 'Koramangala');
  });

  test('applying a filter re-queries and updates the results', () async {
    final repo = _FakeListingRepo();
    final controller = ListingsController(repo);
    await controller.search(filters: const ListingFilters(area: 'Koramangala'));
    expect(controller.state.items, hasLength(2));

    await controller.applyFilters(const ListingFilters(area: 'Koramangala', gender: 'FEMALE'));

    // The new filter reached the repo...
    expect(repo.lastFilters?.gender, 'FEMALE');
    // ...and the result set narrowed accordingly.
    expect(controller.state.items.map((l) => l.id), ['b']);
    expect(repo.browseCalls, 2);
  });

  test('the place geo is retained for the map after a search', () async {
    final controller = ListingsController(_FakeListingRepo());
    await controller.search(
      filters: const ListingFilters(area: 'Koramangala'),
      geo: const GeoPoint(12.93, 77.62),
      placeLabel: 'Koramangala, Bengaluru',
    );
    expect(controller.state.geo, isNotNull);
    expect(controller.state.placeLabel, 'Koramangala, Bengaluru');
  });
}
