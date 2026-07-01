import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/host/listings/application/listing_form_controller.dart';
import 'package:roomadda_host_agent/features/host/listings/data/host_listing_repository.dart';
import 'package:roomadda_host_agent/features/host/listings/domain/host_listing.dart';

/// One dummy on-device photo capture (the real bytes don't matter to the form).
Uint8List _bytes(int i) => Uint8List.fromList([i, i + 1, i + 2]);

/// Records the create-flow calls; everything else falls through noSuchMethod (the
/// form tests only exercise validation, re-queue prediction, and create order).
class _FakeRepo implements HostListingRepository {
  final List<String> calls = [];
  int rooms = 0;
  int beds = 0;
  int photos = 0;
  int presigns = 0;
  int uploads = 0;

  @override
  Future<String> createListing(Map<String, dynamic> body) async {
    calls.add('createListing');
    return 'new-id';
  }

  @override
  Future<String> addRoom(String listingId, Map<String, dynamic> body) async {
    rooms++;
    return 'room-$rooms';
  }

  @override
  Future<void> addBed(String listingId, String roomId, Map<String, dynamic> body) async {
    beds++;
  }

  @override
  Future<void> addPhoto(String listingId, Map<String, dynamic> body) async {
    photos++;
  }

  @override
  Future<ListingPhotoUploadTarget> requestPhotoUploadUrl(String listingId, String contentType) async {
    presigns++;
    return ListingPhotoUploadTarget(
      key: 'listings/$listingId/$presigns.jpg',
      uploadUrl: 'https://stub.local/put/$presigns',
      publicUrl: 'https://cdn.stub.local/listings/$listingId/$presigns.jpg',
    );
  }

  @override
  Future<void> uploadPhotoBytes(String uploadUrl, Uint8List bytes, String contentType) async {
    uploads++;
  }

  /// How many times the listing draft was created (must stay 1 across retries).
  int get creates => calls.where((c) => c == 'createListing').length;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Fails the first photo upload, then succeeds — to prove a retry resumes against
/// the same draft instead of re-creating the listing.
class _FailOncePhotoRepo extends _FakeRepo {
  bool _failed = false;

  @override
  Future<void> uploadPhotoBytes(String uploadUrl, Uint8List bytes, String contentType) async {
    if (!_failed) {
      _failed = true;
      throw Exception('network blip');
    }
    return super.uploadPhotoBytes(uploadUrl, bytes, contentType);
  }
}

HostListing _original({String address = '12 Main Rd', int rent = 800000}) => HostListing.fromJson({
      'id': 'l1',
      'alias': 'Sunrise PG',
      'actualName': 'Sunrise Residency',
      'areaLabel': 'Koramangala',
      'city': 'Bengaluru',
      'pincode': '560001',
      'fullAddress': address,
      'location': {'lat': 12.93, 'lng': 77.62},
      'gender': 'COED',
      'status': 'PUBLISHED',
      'paused': false,
      'instantBook': true,
      'amenities': <String>[],
      'houseRules': <String>[],
      'mealsOffered': false,
      'mealChargesPaise': null,
      'tokenAmountPaise': 200000,
      'priceFromPaise': rent,
      'photos': const [],
      'rooms': [
        {
          'roomId': 'room-1',
          'name': 'Room A',
          'floor': 1,
          'sharingType': 2,
          'monthlyRentPaise': rent,
          'depositPaise': 0,
          'totalBeds': 2,
          'bookedBeds': 0,
          'walkInBeds': 0,
          'heldBeds': 0,
          'availableBeds': 2,
          'needsVerification': false,
          'inventoryVerifiedAt': '2026-06-29T00:00:00.000Z',
        },
      ],
      'createdAt': '2026-06-01T00:00:00.000Z',
      'updatedAt': '2026-06-20T00:00:00.000Z',
    });

/// Fill every required field EXCEPT photos so photo validity can be isolated.
void _fillValidExceptPhotos(ListingFormController c) {
  c
    ..setAlias('Sunrise PG')
    ..setActualName('Sunrise Residency')
    ..setAreaLabel('Koramangala')
    ..setCity('Bengaluru')
    ..setPincode('560001')
    ..setFullAddress('12 Main Rd')
    ..setPin(12.93, 77.62)
    ..setToken(200000)
    ..addRoom();
  c.updateRoom(0, const RoomDraft(name: 'Room A', sharingType: 2, monthlyRentPaise: 800000, bedCount: 2));
}

void main() {
  group('listing form — min-5 photos gate', () {
    test('cannot submit with fewer than 5 photos; can once 5 are added', () {
      final c = ListingFormController(_FakeRepo());
      _fillValidExceptPhotos(c);

      expect(c.state.photosValid, isFalse);
      expect(c.state.canSubmit, isFalse, reason: 'all fields valid but < 5 photos');

      for (var i = 0; i < 4; i++) {
        c.addLocalPhoto(_bytes(i), 'image/jpeg');
      }
      expect(c.state.photosValid, isFalse, reason: '4 photos is still short');
      expect(c.state.canSubmit, isFalse);

      c.addLocalPhoto(_bytes(4), 'image/jpeg');
      expect(c.state.photos, hasLength(5));
      expect(c.state.photosValid, isTrue);
      expect(c.state.canSubmit, isTrue);
    });

    test('removing a photo back under 5 disables submit again', () {
      final c = ListingFormController(_FakeRepo());
      _fillValidExceptPhotos(c);
      for (var i = 0; i < 5; i++) {
        c.addLocalPhoto(_bytes(i), 'image/jpeg');
      }
      expect(c.state.canSubmit, isTrue);
      c.removePhoto(0);
      expect(c.state.photosValid, isFalse);
      expect(c.state.canSubmit, isFalse);
    });
  });

  group('listing form — create orchestration', () {
    test('submitCreate builds listing -> rooms -> beds, then uploads + attaches photos', () async {
      final repo = _FakeRepo();
      final c = ListingFormController(repo);
      _fillValidExceptPhotos(c);
      for (var i = 0; i < 5; i++) {
        c.addLocalPhoto(_bytes(i), 'image/jpeg');
      }

      final id = await c.submitCreate();
      expect(id, 'new-id');
      expect(repo.calls, contains('createListing'));
      expect(repo.rooms, 1);
      expect(repo.beds, 2, reason: 'bedCount=2 -> two beds attached');
      // Each photo is presigned, uploaded to that URL, then attached.
      expect(repo.presigns, 5);
      expect(repo.uploads, 5);
      expect(repo.photos, 5);
      // Every photo is now remote (uploaded) — a re-submit would re-upload none.
      expect(c.state.photos.every((p) => p.isUploaded), isTrue);
    });

    test('a failed photo upload does not duplicate the listing on retry', () async {
      final repo = _FailOncePhotoRepo();
      final c = ListingFormController(repo);
      _fillValidExceptPhotos(c);
      for (var i = 0; i < 5; i++) {
        c.addLocalPhoto(_bytes(i), 'image/jpeg');
      }

      // First attempt fails mid-upload.
      expect(await c.submitCreate(), isNull);
      expect(repo.creates, 1);

      // Retry resumes: listing is NOT re-created, and only the unattached photos
      // are uploaded (so the total upload count ends at 5, not 10).
      final id = await c.submitCreate();
      expect(id, 'new-id');
      expect(repo.creates, 1, reason: 'draft reused, never duplicated');
      expect(repo.photos, 5);
    });

    test('submitCreate refuses when invalid (no calls made)', () async {
      final repo = _FakeRepo();
      final c = ListingFormController(repo);
      _fillValidExceptPhotos(c); // no photos
      final id = await c.submitCreate();
      expect(id, isNull);
      expect(repo.calls, isEmpty);
    });
  });

  group('listing form — edit re-queue prediction', () {
    test('changing the address predicts a re-queue', () {
      final c = ListingFormController(_FakeRepo(), original: _original());
      expect(c.editWouldRequeue, isFalse);
      c.setFullAddress('99 New Street');
      expect(c.editWouldRequeue, isTrue);
    });

    test('a >20% room rent change predicts a re-queue', () {
      final c = ListingFormController(_FakeRepo(), original: _original(rent: 800000));
      // +30% on the existing room.
      c.updateRoom(0, c.state.rooms.first.copyWith(monthlyRentPaise: 1040000));
      expect(c.state.rooms.first.rentRequeues, isTrue);
      expect(c.editWouldRequeue, isTrue);
    });

    test('a minor edit (alias) does not predict a re-queue', () {
      final c = ListingFormController(_FakeRepo(), original: _original());
      c.setAlias('Sunrise PG Deluxe');
      expect(c.editWouldRequeue, isFalse);
    });
  });
}
