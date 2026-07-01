import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_tenant/features/safety/domain/leave_notice.dart';
import 'package:roomadda_tenant/features/safety/domain/trusted_contact.dart';

Map<String, dynamic> _notice({String status = 'ACTIVE', bool canWithdraw = true, String? withdrawnAt}) => {
      'id': 'n1',
      'moveOutDate': '2026-08-01T00:00:00.000Z',
      'status': status,
      'canWithdraw': canWithdraw,
      'withdrawnAt': withdrawnAt,
      'createdAt': '2026-06-28T00:00:00.000Z',
    };

void main() {
  group('LeaveNotice / LeaveNoticeView', () {
    test('parses a notice and the form policy', () {
      final view = LeaveNoticeView.fromJson({
        'items': [_notice()],
        'noticePeriodDays': 30,
        'earliestMoveOutDate': '2026-07-28T00:00:00.000Z',
      });
      expect(view.noticePeriodDays, 30);
      expect(view.earliestMoveOutDate, DateTime.utc(2026, 7, 28));
      expect(view.active, isNotNull);
      expect(view.active!.canWithdraw, isTrue);
    });

    test('active returns null when the only notice is withdrawn', () {
      final view = LeaveNoticeView.fromJson({
        'items': [_notice(status: 'WITHDRAWN', canWithdraw: false, withdrawnAt: '2026-06-29T00:00:00.000Z')],
        'noticePeriodDays': 30,
        'earliestMoveOutDate': '2026-07-28T00:00:00.000Z',
      });
      expect(view.active, isNull);
      expect(view.items.single.isActive, isFalse);
    });
  });

  group('TrustedContactsView', () {
    Map<String, dynamic> contact(String id) =>
        {'id': id, 'name': 'C$id', 'phone': '+91981234567$id', 'createdAt': '2026-06-28T00:00:00.000Z'};

    test('tracks empty / full against the cap', () {
      final empty = TrustedContactsView.fromJson({'items': const [], 'max': 3});
      expect(empty.isEmpty, isTrue);
      expect(empty.isFull, isFalse);

      final full = TrustedContactsView.fromJson({
        'items': [contact('1'), contact('2'), contact('3')],
        'max': 3,
      });
      expect(full.isEmpty, isFalse);
      expect(full.isFull, isTrue);
      expect(full.items.first.name, 'C1');
    });
  });

  group('SosResult', () {
    test('parses the SOS outcome', () {
      final r = SosResult.fromJson({'contactsNotified': 2, 'adminAlerted': true});
      expect(r.contactsNotified, 2);
      expect(r.adminAlerted, isTrue);
    });
  });
}
