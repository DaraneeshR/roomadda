import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/host/service/domain/host_service_request.dart';

Map<String, dynamic> _requestJson({
  String status = 'SUBMITTED',
  bool escalated = false,
  List<Map<String, dynamic>>? comments,
}) =>
    {
      'id': 'r1',
      'ticketNumber': 'SR-2A4F9C',
      'category': 'PLUMBING',
      'description': 'Tap leaking',
      'priority': 'URGENT',
      'status': status,
      'photoCount': 1,
      'escalated': escalated,
      'rating': null,
      'acknowledgedAt': status == 'SUBMITTED' ? null : '2026-06-28T10:00:00.000Z',
      'resolvedAt': status == 'RESOLVED' ? '2026-06-28T12:00:00.000Z' : null,
      'escalatedAt': escalated ? '2026-06-28T11:00:00.000Z' : null,
      'createdAt': '2026-06-28T08:00:00.000Z',
      'updatedAt': '2026-06-28T09:00:00.000Z',
      'tenantName': 'Asha',
      'roomName': 'Room A',
      if (comments != null) 'comments': comments,
    };

void main() {
  group('HostServiceRequest.fromJson (renders the queue + detail)', () {
    test('parses fields, exposes tenant name + room only (no KYC)', () {
      final r = HostServiceRequest.fromJson(_requestJson(escalated: true));
      expect(r.tenantName, 'Asha');
      expect(r.roomName, 'Room A');
      expect(r.isUrgent, isTrue);
      expect(r.escalated, isTrue);
      expect(r.canAcknowledge, isTrue);
      expect(r.canResolve, isTrue);
    });

    test('transition flags follow status', () {
      final ack = HostServiceRequest.fromJson(_requestJson(status: 'ACKNOWLEDGED'));
      expect(ack.canAcknowledge, isFalse);
      expect(ack.canResolve, isTrue);

      final resolved = HostServiceRequest.fromJson(_requestJson(status: 'RESOLVED'));
      expect(resolved.isResolved, isTrue);
      expect(resolved.canResolve, isFalse);
    });

    test('parses the comment thread on detail', () {
      final r = HostServiceRequest.fromJson(_requestJson(comments: [
        {
          'id': 'c1',
          'authorRole': 'HOST',
          'authorName': 'Host',
          'body': 'Plumber visiting tomorrow',
          'createdAt': '2026-06-28T09:30:00.000Z',
        },
      ]));
      expect(r.comments, hasLength(1));
      expect(r.comments.first.authorRole, 'HOST');
    });
  });

  group('HostServiceQueue.fromJson (queue + rollup stats)', () {
    test('parses items and stats', () {
      final q = HostServiceQueue.fromJson({
        'items': [_requestJson(escalated: true)],
        'nextCursor': null,
        'stats': {'openCount': 3, 'escalatedCount': 1, 'avgResolutionHours': 5.5},
      });
      expect(q.items, hasLength(1));
      expect(q.stats.openCount, 3);
      expect(q.stats.escalatedCount, 1);
      expect(q.stats.avgResolutionHours, 5.5);
    });

    test('avgResolutionHours may be null when nothing is resolved', () {
      final q = HostServiceQueue.fromJson({
        'items': <Map<String, dynamic>>[],
        'nextCursor': null,
        'stats': {'openCount': 0, 'escalatedCount': 0, 'avgResolutionHours': null},
      });
      expect(q.stats.avgResolutionHours, isNull);
    });
  });
}
