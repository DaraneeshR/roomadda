import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_core/roomadda_core.dart';
import 'package:roomadda_tenant/features/discovery/domain/listing.dart';
import 'package:roomadda_tenant/features/wishlist/application/wishlist_controller.dart';
import 'package:roomadda_tenant/features/wishlist/data/wishlist_repository.dart';

PublicListing _listing(String id) => PublicListing(
      id: id,
      alias: 'PG $id',
      areaLabel: 'Area',
      city: 'City',
      gender: 'COED',
      status: 'PUBLISHED',
      amenities: const [],
      priceFrom: const Paise(700000),
      instantBook: true,
      photos: const [],
      rooms: const [],
      approxLocation: const GeoPoint(12.9, 77.6),
      masked: true,
    );

/// In-memory wishlist backend keyed by id; records add/remove calls.
class _FakeWishlistRepo implements WishlistRepository {
  final List<String> added = [];
  final List<String> removed = [];
  final Map<String, PublicListing> _store = {};

  @override
  Future<List<PublicListing>> list({String? cursor, int limit = 20}) async => _store.values.toList();

  @override
  Future<void> add(String listingId) async {
    added.add(listingId);
    _store[listingId] = _listing(listingId);
  }

  @override
  Future<void> remove(String listingId) async {
    removed.add(listingId);
    _store.remove(listingId);
  }
}

void main() {
  test('toggle saves then removes, per-user state stays in sync', () async {
    final repo = _FakeWishlistRepo();
    final controller = WishlistController(repo);
    await controller.load();
    expect(controller.state.isEmpty, isTrue);

    final listing = _listing('l1');
    await controller.toggle(listing);
    expect(controller.isSaved('l1'), isTrue);
    expect(repo.added, ['l1']);
    expect(controller.state.items.map((l) => l.id), ['l1']);

    await controller.toggle(listing);
    expect(controller.isSaved('l1'), isFalse);
    expect(repo.removed, ['l1']);
    expect(controller.state.isEmpty, isTrue);
  });
}
