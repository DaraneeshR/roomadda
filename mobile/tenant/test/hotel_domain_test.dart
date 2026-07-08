import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_tenant/features/hotel/domain/hotel.dart';

/// A masked hotel search payload as `/v1/hotels/search` actually returns it: the
/// listing is the MASKED public shape (alias + area only — no actualName / exact
/// geo) and each category carries a SERVER-COMPUTED `totalPaise` alongside the
/// per-night rate and the real free-room count.
Map<String, dynamic> _searchResultJson({
  int perNight = 500000,
  int nights = 3,
  int total = 1500000,
  int availableRooms = 2,
  bool leakUnmasked = false,
}) =>
    {
      'listing': {
        'id': 'h1',
        'alias': 'Skyline Suites',
        'areaLabel': 'MG Road',
        'city': 'Bengaluru',
        'gender': 'COED',
        'status': 'PUBLISHED',
        'amenities': ['WiFi', 'AC'],
        'priceFromPaise': perNight,
        'photos': [
          {'id': 'p1', 'url': 'https://cdn/x.jpg', 'isPrimary': true, 'sortOrder': 0},
        ],
        'rooms': const [],
        'masked': true,
        'approxLocation': {'lat': 12.97, 'lng': 77.6},
        if (leakUnmasked) ...{
          'actualName': 'Grand Skyline Hotel (REAL)',
          'fullAddress': '1 Real Road, MG Road',
          'location': {'lat': 12.9721, 'lng': 77.6033},
        },
      },
      'categories': [
        {
          'categoryId': 'c1',
          'tier': 'Deluxe',
          'perNightPaise': perNight,
          'nights': nights,
          'totalPaise': total,
          'availableRooms': availableRooms,
          'photos': const [],
          'amenities': const [],
        },
      ],
    };

Map<String, dynamic> _reservationJson({
  required String status,
  int perNight = 500000,
  int nights = 3,
  int roomTotal = 1500000,
  int token = 1500000,
  String? qrCodeToken,
}) =>
    {
      'id': 'r1',
      'listingId': 'h1',
      'categoryId': 'c1',
      'status': status,
      'checkIn': '2026-07-10',
      'checkOut': '2026-07-13',
      'nights': nights,
      'perNightPaise': perNight,
      'roomTotalPaise': roomTotal,
      'tokenAmountPaise': token,
      'holdExpiresAt': null,
      'confirmedAt': status == 'CONFIRMED' ? '2026-07-09T10:00:00.000Z' : null,
      'qrCodeToken': qrCodeToken,
      'createdAt': '2026-07-09T09:00:00.000Z',
    };

void main() {
  group('money is the server snapshot, never client nights × price', () {
    test('category total is READ from the server, not recomputed', () {
      final result = HotelSearchResult.fromJson(_searchResultJson());
      final category = result.categories.single;
      // Sanity: with a consistent payload the total is the server value.
      expect(category.perNight.value, 500000);
      expect(category.nights, 3);
      expect(category.total.value, 1500000);
    });

    test('a total that disagrees with perNight × nights is still shown verbatim', () {
      // Deliberately inconsistent server payload: if the client were multiplying
      // perNight × nights it would show 1,500,000. It must instead surface the
      // server's total (999) exactly — proving it reads, never derives.
      final result = HotelSearchResult.fromJson(
        _searchResultJson(perNight: 500000, nights: 3, total: 999),
      );
      expect(result.categories.single.total.value, 999);
      expect(result.categories.single.total.value, isNot(500000 * 3));
    });

    test('reservation token + room total are read straight from the DTO', () {
      final r = HotelReservation.fromJson(
        _reservationJson(status: 'HELD', perNight: 500000, nights: 3, roomTotal: 777, token: 777),
      );
      expect(r.tokenAmount.value, 777);
      expect(r.roomTotal.value, 777);
      // Not the client-multiplied figure.
      expect(r.roomTotal.value, isNot(500000 * 3));
    });

    test('"from" price is the cheapest server per-night rate (a read, not math)', () {
      final json = _searchResultJson();
      (json['categories'] as List).add({
        'categoryId': 'c2',
        'tier': 'Suite',
        'perNightPaise': 800000,
        'nights': 3,
        'totalPaise': 2400000,
        'availableRooms': 1,
        'photos': const [],
        'amenities': const [],
      });
      final result = HotelSearchResult.fromJson(json);
      expect(result.fromPerNight?.value, 500000);
    });
  });

  group('masking holds pre-booking', () {
    test('the search result listing is masked (no real name/address)', () {
      final result = HotelSearchResult.fromJson(_searchResultJson());
      expect(result.listing.masked, isTrue);
      expect(result.listing.alias, 'Skyline Suites');
      expect(result.listing.actualName, isNull);
      expect(result.listing.fullAddress, isNull);
      expect(result.listing.exactLocation, isNull);
    });

    test('leaked unmasked fields are dropped on a masked payload', () {
      final result = HotelSearchResult.fromJson(_searchResultJson(leakUnmasked: true));
      expect(result.listing.actualName, isNull);
      expect(result.listing.fullAddress, isNull);
      expect(result.listing.exactLocation, isNull);
      final exposed = [
        result.listing.alias,
        result.listing.areaLabel,
        result.listing.city,
        ...result.listing.amenities,
      ].join('|');
      expect(exposed.contains('REAL'), isFalse);
      expect(exposed.contains('Real Road'), isFalse);
    });
  });

  group('check-in code appears only on the webhook-confirmed reservation', () {
    test('a HELD reservation has no check-in code even if a token leaks in', () {
      final r = HotelReservation.fromJson(
        _reservationJson(status: 'HELD', qrCodeToken: 'hqr_should_not_show'),
      );
      expect(r.isConfirmed, isFalse);
      expect(r.checkInCode, isNull);
    });

    test('a CONFIRMED reservation surfaces the minted check-in code', () {
      final r = HotelReservation.fromJson(
        _reservationJson(status: 'CONFIRMED', qrCodeToken: 'hqr_abc123'),
      );
      expect(r.isConfirmed, isTrue);
      expect(r.checkInCode, 'hqr_abc123');
    });

    test('an EXPIRED/CANCELLED reservation is a terminal non-success', () {
      expect(HotelReservation.fromJson(_reservationJson(status: 'EXPIRED')).isEnded, isTrue);
      expect(HotelReservation.fromJson(_reservationJson(status: 'CANCELLED')).isEnded, isTrue);
    });
  });

  group('category bookability', () {
    test('bookable needs a nightly price AND a free room', () {
      final ok = HotelSearchResult.fromJson(_searchResultJson(availableRooms: 2)).categories.single;
      expect(ok.isBookable, isTrue);
      final soldOut = HotelSearchResult.fromJson(_searchResultJson(availableRooms: 0)).categories.single;
      expect(soldOut.isBookable, isFalse);
      final priceless = HotelSearchResult.fromJson(_searchResultJson(perNight: 0)).categories.single;
      expect(priceless.isBookable, isFalse);
    });
  });
}
