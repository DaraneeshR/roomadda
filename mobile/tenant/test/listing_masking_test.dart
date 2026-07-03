import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_tenant/features/discovery/domain/listing.dart';

/// A masked payload as the public API actually returns it (no actualName /
/// fullAddress / pincode / exact geo — only alias + areaLabel + approxLocation).
Map<String, dynamic> _maskedJson({bool leakUnmasked = false}) => {
      'id': 'l1',
      'alias': 'Sunrise PG',
      'areaLabel': 'Koramangala',
      'city': 'Bengaluru',
      'gender': 'FEMALE',
      'status': 'PUBLISHED',
      'amenities': ['WiFi', 'AC'],
      'priceFromPaise': 850000,
      'photos': [
        {'id': 'p1', 'url': 'https://cdn/x.jpg', 'isPrimary': true, 'sortOrder': 0},
      ],
      'rooms': [
        {'id': 'r1', 'name': 'Room 1', 'floor': 1, 'sharingType': 2, 'monthlyRentPaise': 850000, 'depositPaise': 1700000, 'tokenAmountPaise': 200000, 'totalBeds': 3, 'availableBeds': 2},
      ],
      'masked': true,
      'approxLocation': {'lat': 12.93, 'lng': 77.62},
      // A server that erroneously leaked unmasked fields must STILL not surface
      // them through the client model.
      if (leakUnmasked) ...{
        'actualName': 'Sunrise Residency (REAL)',
        'fullAddress': '12 Real Street, Koramangala',
        'pincode': '560034',
        'location': {'lat': 12.9352, 'lng': 77.6245},
      },
    };

/// An UNMASKED payload as the server returns it to a caller allowed to see it
/// (a CONFIRMED tenant / owner / admin / agent): `masked: false` plus the real
/// name, full address, and exact geo (`location`, not `approxLocation`).
Map<String, dynamic> _unmaskedJson() => {
      'id': 'l1',
      'alias': 'Sunrise PG',
      'areaLabel': 'Koramangala',
      'city': 'Bengaluru',
      'gender': 'FEMALE',
      'status': 'PUBLISHED',
      'amenities': ['WiFi', 'AC'],
      'priceFromPaise': 850000,
      'photos': const [],
      'rooms': [
        {'id': 'r1', 'name': 'Room 1', 'floor': 1, 'sharingType': 2, 'monthlyRentPaise': 850000, 'depositPaise': 1700000, 'tokenAmountPaise': 200000, 'totalBeds': 3, 'availableBeds': 2},
      ],
      'masked': false,
      'actualName': 'Sunrise Residency (REAL)',
      'fullAddress': '12 Real Street, Koramangala',
      'pincode': '560034',
      'location': {'lat': 12.9352, 'lng': 77.6245},
    };

void main() {
  test('parses only masked fields', () {
    final l = PublicListing.fromJson(_maskedJson());
    expect(l.masked, isTrue);
    expect(l.alias, 'Sunrise PG');
    expect(l.areaLabel, 'Koramangala');
    expect(l.startingRent?.value, 850000);
    expect(l.coverPhoto?.url, 'https://cdn/x.jpg');
    expect(l.rooms.single.availableBeds, 2);
    // Browse results have no distance; only nearby does.
    expect(l.distanceMeters, isNull);
  });

  test('never surfaces unmasked fields even if the server leaks them', () {
    final l = PublicListing.fromJson(_maskedJson(leakUnmasked: true));
    // On a masked payload the reveal fields are dropped, even when the server
    // wrongly included them: the only name is the masked alias, the only
    // location the coarse approx.
    expect(l.alias, 'Sunrise PG');
    expect(l.areaLabel, 'Koramangala');
    expect(l.approxLocation.lat, 12.93);
    expect(l.actualName, isNull);
    expect(l.fullAddress, isNull);
    expect(l.exactLocation, isNull);
    // Nothing the model exposes equals the leaked secret values.
    final exposed = [l.alias, l.areaLabel, l.city, l.gender, l.status, ...l.amenities].join('|');
    expect(exposed.contains('REAL'), isFalse);
    expect(exposed.contains('Real Street'), isFalse);
    expect(exposed.contains('560034'), isFalse);
  });

  test('reveals the real address + exact geo on an UNMASKED payload', () {
    final l = PublicListing.fromJson(_unmaskedJson());
    expect(l.masked, isFalse);
    expect(l.actualName, 'Sunrise Residency (REAL)');
    expect(l.fullAddress, '12 Real Street, Koramangala');
    expect(l.exactLocation?.lat, 12.9352);
    expect(l.exactLocation?.lng, 77.6245);
  });

  test('room carries the server token (no client-side deposit/rent guess)', () {
    final l = PublicListing.fromJson(_maskedJson());
    // The seeded token is ₹2,000 (200000 paise) — NOT the deposit (1700000) or
    // rent (850000). The sheet must display exactly this.
    expect(l.rooms.single.tokenAmount?.value, 200000);
    expect(l.rooms.single.tokenAmount?.value, isNot(l.rooms.single.deposit.value));
    expect(l.rooms.single.tokenAmount?.value, isNot(l.rooms.single.monthlyRent.value));
  });

  test('room token is null (not guessed) when the server omits it', () {
    final json = _maskedJson();
    final room = (json['rooms'] as List).single as Map<String, dynamic>;
    room.remove('tokenAmountPaise');
    final l = PublicListing.fromJson(json);
    expect(l.rooms.single.tokenAmount, isNull);
  });

  test('carries distanceMeters on nearby results', () {
    final l = PublicListing.fromJson({..._maskedJson(), 'distanceMeters': 1200});
    expect(l.distanceMeters, 1200);
  });
}
