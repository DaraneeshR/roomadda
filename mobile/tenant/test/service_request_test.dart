import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_tenant/features/service/domain/service_request.dart';

Map<String, dynamic> _json({
  String status = 'SUBMITTED',
  String priority = 'NORMAL',
  bool escalated = false,
  int? rating,
  int photoCount = 0,
  List<Map<String, dynamic>>? comments,
}) =>
    {
      'id': 'r1',
      'ticketNumber': 'SR-2A4F9C',
      'category': 'PLUMBING',
      'description': 'Tap is leaking',
      'priority': priority,
      'status': status,
      'photoCount': photoCount,
      'escalated': escalated,
      'rating': rating,
      'acknowledgedAt': null,
      'resolvedAt': status == 'RESOLVED' ? '2026-06-28T10:00:00.000Z' : null,
      'createdAt': '2026-06-28T08:00:00.000Z',
      'updatedAt': '2026-06-28T09:00:00.000Z',
      if (comments != null) 'comments': comments,
    };

void main() {
  group('ServiceRequest.fromJson', () {
    test('parses core fields and defaults comments to empty (list rows)', () {
      final r = ServiceRequest.fromJson(_json(priority: 'URGENT', escalated: true, photoCount: 2));
      expect(r.ticketNumber, 'SR-2A4F9C');
      expect(r.category, 'PLUMBING');
      expect(r.isUrgent, isTrue);
      expect(r.escalated, isTrue);
      expect(r.photoCount, 2);
      expect(r.comments, isEmpty);
    });

    test('parses the comment thread on detail', () {
      final r = ServiceRequest.fromJson(_json(comments: [
        {
          'id': 'c1',
          'authorRole': 'TENANT',
          'authorName': 'Asha',
          'body': 'Still leaking',
          'createdAt': '2026-06-28T09:30:00.000Z',
        },
      ]));
      expect(r.comments, hasLength(1));
      expect(r.comments.first.authorName, 'Asha');
      expect(r.comments.first.authorRole, 'TENANT');
    });
  });

  group('rating prompt logic', () {
    test('a resolved, unrated request needs a rating', () {
      expect(ServiceRequest.fromJson(_json(status: 'RESOLVED')).needsRating, isTrue);
    });

    test('an already-rated resolved request does not prompt again', () {
      expect(ServiceRequest.fromJson(_json(status: 'RESOLVED', rating: 5)).needsRating, isFalse);
    });

    test('an unresolved request never prompts for a rating', () {
      expect(ServiceRequest.fromJson(_json(status: 'ACKNOWLEDGED')).needsRating, isFalse);
      expect(ServiceRequest.fromJson(_json(status: 'SUBMITTED')).needsRating, isFalse);
    });
  });

  group('status + category helpers', () {
    test('status maps to the right tracker step', () {
      expect(serviceStatusStep('SUBMITTED'), 0);
      expect(serviceStatusStep('ACKNOWLEDGED'), 1);
      expect(serviceStatusStep('RESOLVED'), 2);
    });

    test('category labels are human-readable', () {
      expect(serviceCategoryLabel('WIFI'), 'Wi-Fi');
      expect(serviceCategoryLabel('PEST_CONTROL'), 'Pest control');
      expect(serviceCategoryLabel('PLUMBING'), 'Plumbing');
    });
  });
}
