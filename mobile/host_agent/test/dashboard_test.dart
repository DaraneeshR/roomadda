import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/host/dashboard/domain/host_dashboard.dart';
import 'package:roomadda_host_agent/features/host/dashboard/domain/revenue_summary.dart';
import 'package:roomadda_host_agent/features/host/listings/domain/host_listing.dart';

RevenueSummary _rev({int expected = 0, int collected = 0, int overdue = 0, int occ = 0, int vac = 0, int total = 0}) =>
    RevenueSummary.fromJson({
      'listingId': 'l1',
      'expectedPaise': expected,
      'collectedPaise': collected,
      'overduePaise': overdue,
      'occupiedBeds': occ,
      'vacantBeds': vac,
      'totalBeds': total,
      'months': const [],
      'generatedAt': '2026-06-30T00:00:00.000Z',
    });

HostListing _listing(String id) => HostListing.fromJson({
      'id': id,
      'alias': 'PG $id',
      'actualName': 'PG $id',
      'areaLabel': 'Area',
      'city': 'Bengaluru',
      'pincode': '560001',
      'fullAddress': 'addr',
      'location': {'lat': 12.9, 'lng': 77.6},
      'gender': 'COED',
      'status': 'PUBLISHED',
      'paused': false,
      'instantBook': true,
      'amenities': const <String>[],
      'houseRules': const <String>[],
      'mealsOffered': false,
      'mealChargesPaise': null,
      'tokenAmountPaise': 200000,
      'priceFromPaise': 800000,
      'photos': const [],
      'rooms': const [],
      'createdAt': '2026-06-01T00:00:00.000Z',
      'updatedAt': '2026-06-20T00:00:00.000Z',
    });

void main() {
  group('RevenueSummary.fromJson', () {
    test('parses money as Paise + occupancy', () {
      final r = _rev(expected: 1000000, collected: 600000, overdue: 200000, occ: 4, vac: 2, total: 6);
      expect(r.expected.value, 1000000);
      expect(r.collected.value, 600000);
      expect(r.overdue.value, 200000);
      expect(r.occupiedBeds, 4);
      expect(r.vacantBeds, 2);
    });
  });

  group('HostDashboard.from (portfolio rollup across listings)', () {
    test('sums revenue + beds across listings and keeps the counts', () {
      final dash = HostDashboard.from(
        listings: [_listing('a'), _listing('b')],
        revenues: [
          _rev(expected: 1000000, collected: 800000, overdue: 0, occ: 3, vac: 1, total: 4),
          _rev(expected: 500000, collected: 250000, overdue: 250000, occ: 2, vac: 2, total: 4),
        ],
        pendingRequests: 2,
        openServiceRequests: 5,
        escalatedServiceRequests: 1,
      );
      expect(dash.expected.value, 1500000);
      expect(dash.collected.value, 1050000);
      expect(dash.overdue.value, 250000);
      expect(dash.occupiedBeds, 5);
      expect(dash.vacantBeds, 3);
      expect(dash.totalBeds, 8);
      expect(dash.pendingRequests, 2);
      expect(dash.openServiceRequests, 5);
      expect(dash.escalatedServiceRequests, 1);
      expect(dash.liveListings, 2);
    });

    test('collection rate is 0 when nothing is expected', () {
      final dash = HostDashboard.from(
        listings: const [],
        revenues: const [],
        pendingRequests: 0,
        openServiceRequests: 0,
        escalatedServiceRequests: 0,
      );
      expect(dash.collectionRate, 0);
      expect(dash.hasListings, isFalse);
    });
  });
}
