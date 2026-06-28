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
        {'id': 'r1', 'name': 'Room 1', 'floor': 1, 'sharingType': 2, 'monthlyRentPaise': 850000, 'depositPaise': 1700000, 'totalBeds': 3, 'availableBeds': 2},
      ],
      'masked': true,
      'approxLocation': {'lat': 12.93, 'lng': 77.62},
      // A server that erroneously leaked unmasked fields must STILL not surface
      // them through the client model.
      if (leakUnmasked) ...{
        'actualName': 'Sunrise Residency (REAL)',
        'fullAddress': '12 Real Street, Koramangala',
        'pincode': '560034',
      },
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
    // The model has no field for actualName/fullAddress/pincode — the only name
    // it can show is the masked alias, and the only location is the coarse approx.
    expect(l.alias, 'Sunrise PG');
    expect(l.areaLabel, 'Koramangala');
    expect(l.approxLocation.lat, 12.93);
    // Nothing the model exposes equals the leaked secret values.
    final exposed = [l.alias, l.areaLabel, l.city, l.gender, l.status, ...l.amenities].join('|');
    expect(exposed.contains('REAL'), isFalse);
    expect(exposed.contains('Real Street'), isFalse);
    expect(exposed.contains('560034'), isFalse);
  });

  test('carries distanceMeters on nearby results', () {
    final l = PublicListing.fromJson({..._maskedJson(), 'distanceMeters': 1200});
    expect(l.distanceMeters, 1200);
  });
}
