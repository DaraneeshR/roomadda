import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/host/listings/domain/edit_classify.dart';
import 'package:roomadda_host_agent/features/host/listings/domain/host_listing.dart';

Map<String, dynamic> _roomJson({
  String roomId = 'room-1',
  int rent = 800000,
  int total = 3,
  int booked = 1,
  int walkIn = 0,
  int held = 0,
  int available = 2,
  bool needsVerification = false,
}) =>
    {
      'roomId': roomId,
      'name': 'Room A',
      'floor': 1,
      'sharingType': 3,
      'monthlyRentPaise': rent,
      'depositPaise': rent,
      'totalBeds': total,
      'bookedBeds': booked,
      'walkInBeds': walkIn,
      'heldBeds': held,
      'availableBeds': available,
      'needsVerification': needsVerification,
      'inventoryVerifiedAt': needsVerification ? null : '2026-06-29T00:00:00.000Z',
    };

Map<String, dynamic> _listingJson({
  String status = 'PUBLISHED',
  bool paused = false,
  List<Map<String, dynamic>>? rooms,
}) =>
    {
      'id': 'l1',
      'alias': 'Sunrise PG',
      'actualName': 'Sunrise Residency',
      'areaLabel': 'Koramangala',
      'city': 'Bengaluru',
      'pincode': '560001',
      'fullAddress': '12 Main Rd',
      'location': {'lat': 12.93, 'lng': 77.62},
      'gender': 'COED',
      'status': status,
      'paused': paused,
      'instantBook': true,
      'amenities': ['WiFi', 'AC'],
      'houseRules': ['No smoking'],
      'mealsOffered': true,
      'mealChargesPaise': 300000,
      'tokenAmountPaise': 200000,
      'priceFromPaise': 800000,
      'photos': [
        {'id': 'p1', 'url': 'https://x/1.jpg', 'isPrimary': true, 'sortOrder': 0},
      ],
      'rooms': rooms ?? [_roomJson()],
      'createdAt': '2026-06-01T00:00:00.000Z',
      'updatedAt': '2026-06-20T00:00:00.000Z',
    };

void main() {
  group('HostListing.fromJson (renders the host listing endpoint)', () {
    test('parses unmasked fields, money as Paise and rooms', () {
      final l = HostListing.fromJson(_listingJson());
      expect(l.alias, 'Sunrise PG');
      expect(l.actualName, 'Sunrise Residency'); // unmasked: the host owns it
      expect(l.fullAddress, '12 Main Rd');
      expect(l.tokenAmount?.value, 200000);
      expect(l.priceFrom?.value, 800000);
      expect(l.rooms, hasLength(1));
      expect(l.rooms.first.monthlyRent.value, 800000);
      expect(l.isLive, isTrue);
    });

    test('derives bed totals and live/draft/pending state', () {
      final draft = HostListing.fromJson(_listingJson(status: 'DRAFT'));
      expect(draft.isDraft, isTrue);
      expect(draft.isLive, isFalse);

      final paused = HostListing.fromJson(_listingJson(paused: true));
      expect(paused.isLive, isFalse);

      final l = HostListing.fromJson(_listingJson(rooms: [_roomJson(total: 3, available: 2)]));
      expect(l.totalBeds, 3);
      expect(l.availableBeds, 2);
    });

    test('flags stale inventory when any room needs verification', () {
      final l = HostListing.fromJson(_listingJson(rooms: [_roomJson(needsVerification: true)]));
      expect(l.hasStaleInventory, isTrue);
      expect(l.rooms.first.occupiedBeds, 1); // booked(1)+walkin(0)+held(0)
    });
  });

  group('edit classification (re-queue prediction mirrors the backend)', () {
    test('an address-field change re-queues', () {
      expect(listingEditRequeues(['fullAddress']), isTrue);
      expect(listingEditRequeues(['pincode']), isTrue);
      expect(listingEditRequeues(['latitude']), isTrue);
      expect(listingEditRequeues(['longitude']), isTrue);
    });

    test('a minor (non-address) change does not re-queue', () {
      expect(listingEditRequeues(['alias', 'amenities', 'houseRules']), isFalse);
    });

    test('a rent change over 20% is significant; under is not', () {
      expect(isRentChangeSignificant(1000000, 1300000), isTrue); // +30%
      expect(isRentChangeSignificant(1000000, 1150000), isFalse); // +15%
      expect(isRentChangeSignificant(0, 800000), isTrue); // off zero is always significant
    });
  });
}
