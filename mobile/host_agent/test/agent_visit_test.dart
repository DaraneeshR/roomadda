import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/agent/visits/domain/agent_visit.dart';

Map<String, dynamic> _visitJson({Map<String, dynamic>? checkIn, String? inspectionStatus, String status = 'SCHEDULED'}) => {
      'id': 'visit-1',
      'listingId': 'listing-1',
      'alias': 'Sunrise PG',
      'actualName': 'Sunrise Residency',
      'areaLabel': 'Koramangala',
      'city': 'Bengaluru',
      'fullAddress': '12 Main Rd, Koramangala',
      'latitude': 12.9352,
      'longitude': 77.6245,
      'status': status,
      'scheduledAt': '2026-07-01T09:30:00.000Z',
      'visitedAt': null,
      'notes': 'Gate code 4432',
      'checkIn': checkIn,
      'inspectionStatus': inspectionStatus,
    };

void main() {
  group('AgentVisit.fromJson (endpoint shape parses)', () {
    test('parses the unmasked property fields and a null check-in', () {
      final v = AgentVisit.fromJson(_visitJson());
      expect(v.actualName, 'Sunrise Residency'); // agent is privileged → unmasked
      expect(v.fullAddress, '12 Main Rd, Koramangala');
      expect(v.latitude, closeTo(12.9352, 1e-9));
      expect(v.checkIn, isNull);
      expect(v.hasValidCheckIn, isFalse);
      expect(v.checkedInOutOfRange, isFalse);
    });

    test('a within-range check-in unlocks the inspection', () {
      final v = AgentVisit.fromJson(_visitJson(checkIn: {
        'lat': 12.9352,
        'lng': 77.6245,
        'at': '2026-07-01T09:35:00.000Z',
        'distanceM': 18.0,
        'withinRange': true,
      }));
      expect(v.hasValidCheckIn, isTrue);
      expect(v.checkedInOutOfRange, isFalse);
    });

    test('an out-of-range check-in is the "cannot reach" flag path, still locked', () {
      final v = AgentVisit.fromJson(_visitJson(checkIn: {
        'lat': 12.90,
        'lng': 77.60,
        'at': '2026-07-01T09:35:00.000Z',
        'distanceM': 4200.0,
        'withinRange': false,
      }));
      expect(v.hasValidCheckIn, isFalse); // inspection stays locked
      expect(v.checkedInOutOfRange, isTrue);
    });

    test('inspection status flags submitted vs draft', () {
      expect(AgentVisit.fromJson(_visitJson(inspectionStatus: 'SUBMITTED')).inspectionSubmitted, isTrue);
      expect(AgentVisit.fromJson(_visitJson(inspectionStatus: 'DRAFT')).inspectionSubmitted, isFalse);
      expect(AgentVisit.fromJson(_visitJson()).inspectionSubmitted, isFalse);
    });
  });

  group('CheckInResult.fromJson', () {
    test('parses the server verdict (within range)', () {
      final r = CheckInResult.fromJson({
        'visitId': 'visit-1',
        'withinRange': true,
        'cannotReachProperty': false,
        'distanceM': 42.0,
        'radiusM': 200.0,
        'checkedInAt': '2026-07-01T09:35:00.000Z',
      });
      expect(r.withinRange, isTrue);
      expect(r.cannotReachProperty, isFalse);
      expect(r.distanceM, 42.0);
      expect(r.radiusM, 200.0);
    });

    test('an out-of-range verdict flags cannot-reach and does not validate', () {
      final r = CheckInResult.fromJson({
        'visitId': 'visit-1',
        'withinRange': false,
        'cannotReachProperty': true,
        'distanceM': null,
        'radiusM': 200.0,
        'checkedInAt': '2026-07-01T09:35:00.000Z',
      });
      expect(r.withinRange, isFalse);
      expect(r.cannotReachProperty, isTrue);
      expect(r.distanceM, isNull);
    });
  });
}
