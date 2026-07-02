import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/agent/inspection/domain/inspection.dart';

List<Map<String, dynamic>> _photos(int n) => List.generate(
      n,
      (i) => {
        'id': 'p$i',
        'lat': 12.9 + i * 0.0001,
        'lng': 77.6 + i * 0.0001,
        'takenAt': '2026-07-01T09:${(40 + i).toString().padLeft(2, '0')}:00.000Z',
      },
    );

Map<String, dynamic> _inspectionJson({
  String status = 'DRAFT',
  int photoCount = 0,
  Map<String, dynamic>? amenities,
  int? roomCountActual,
  Map<String, dynamic>? cleanliness,
  String? recommendation,
}) =>
    {
      'id': 'insp-1',
      'visitId': 'visit-1',
      'listingId': 'listing-1',
      'status': status,
      'amenities': amenities,
      'roomCountListed': 6,
      'roomCountActual': roomCountActual,
      'cleanliness': cleanliness,
      'securityInfra': {'CCTV': true, 'Emergency exit': false},
      'discrepancies': 'One room smaller than listed',
      'recommendation': recommendation,
      'notesForAdmin': null,
      'photoCount': photoCount,
      'photos': _photos(photoCount),
      'submittedAt': status == 'DRAFT' ? null : '2026-07-01T10:00:00.000Z',
      'createdAt': '2026-07-01T09:00:00.000Z',
      'updatedAt': '2026-07-01T09:50:00.000Z',
    };

void main() {
  group('Inspection.fromJson (endpoint shape parses)', () {
    test('parses enums, typed maps and photos', () {
      final insp = Inspection.fromJson(_inspectionJson(
        photoCount: 2,
        amenities: {'WiFi': 'YES', 'Lift': 'PARTIAL'},
        roomCountActual: 5,
        cleanliness: {'Rooms': 4, 'Bathrooms': 3},
        recommendation: 'APPROVE_WITH_CONDITIONS',
      ));
      expect(insp.status, 'DRAFT');
      expect(insp.amenities!['WiFi'], AmenityCheck.yes);
      expect(insp.amenities!['Lift'], AmenityCheck.partial);
      expect(insp.cleanliness!['Rooms'], 4);
      expect(insp.securityInfra!['CCTV'], isTrue);
      expect(insp.recommendation, InspectionRecommendation.approveWithConditions);
      expect(insp.roomCountListed, 6);
      expect(insp.roomCountActual, 5);
      expect(insp.photos, hasLength(2));
      expect(insp.isDraft, isTrue);
    });

    test('a submitted inspection is locked', () {
      final insp = Inspection.fromJson(_inspectionJson(status: 'SUBMITTED', photoCount: 8));
      expect(insp.isSubmitted, isTrue);
      expect(insp.isDraft, isFalse);
      expect(insp.submittedAt, isNotNull);
    });

    test('enum api values round-trip to the backend shape', () {
      expect(AmenityCheck.partial.api, 'PARTIAL');
      expect(InspectionRecommendation.approveWithConditions.api, 'APPROVE_WITH_CONDITIONS');
      expect(AmenityCheck.fromApi('NO'), AmenityCheck.no);
      expect(InspectionRecommendation.fromApi('REJECT'), InspectionRecommendation.reject);
    });
  });

  group('InspectionGate (locked without check-in; blocked under 8 photos)', () {
    test('locked without a valid check-in — even with everything else ready', () {
      expect(
        InspectionGate.canSubmit(hasValidCheckIn: false, photoCount: 12, hasRequiredFields: true),
        isFalse,
      );
      final blockers = InspectionGate.blockers(hasValidCheckIn: false, photoCount: 12, missingFields: const []);
      expect(blockers.any((b) => b.contains('check-in')), isTrue);
    });

    test('blocked under 8 photos — even with a valid check-in and fields', () {
      expect(
        InspectionGate.canSubmit(hasValidCheckIn: true, photoCount: 7, hasRequiredFields: true),
        isFalse,
      );
      final blockers = InspectionGate.blockers(hasValidCheckIn: true, photoCount: 7, missingFields: const []);
      expect(blockers.any((b) => b.contains('more photo')), isTrue);
      // Exactly the minimum is enough.
      expect(
        InspectionGate.canSubmit(hasValidCheckIn: true, photoCount: kMinInspectionPhotos, hasRequiredFields: true),
        isTrue,
      );
    });

    test('blocked while required fields are missing', () {
      expect(
        InspectionGate.canSubmit(hasValidCheckIn: true, photoCount: 8, hasRequiredFields: false),
        isFalse,
      );
      final blockers = InspectionGate.blockers(
        hasValidCheckIn: true,
        photoCount: 8,
        missingFields: const ['recommendation'],
      );
      expect(blockers.any((b) => b.contains('recommendation')), isTrue);
    });

    test('ready when a valid check-in, >=8 photos and required fields are all present', () {
      expect(
        InspectionGate.canSubmit(hasValidCheckIn: true, photoCount: 8, hasRequiredFields: true),
        isTrue,
      );
      expect(
        InspectionGate.blockers(hasValidCheckIn: true, photoCount: 8, missingFields: const []),
        isEmpty,
      );
    });
  });
}
