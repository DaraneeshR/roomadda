import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_tenant/features/booking/domain/booking.dart' show RazorpayOrder;
import 'package:roomadda_tenant/features/rent/application/rent_payment_poller.dart';
import 'package:roomadda_tenant/features/rent/data/rent_repository.dart';
import 'package:roomadda_tenant/features/rent/domain/rent_invoice.dart';

Map<String, dynamic> _json({String status = 'DUE', int daysOverdue = 0, String? paidAt}) => {
      'id': 'inv1',
      'bookingId': 'bk1',
      'periodMonth': '2026-07-01T00:00:00.000Z',
      'periodLabel': 'July 2026',
      'amountPaise': 1200000,
      'dueDate': '2026-07-15T00:00:00.000Z',
      'status': status,
      'daysOverdue': daysOverdue,
      'paidAt': paidAt,
      'createdAt': '2026-07-01T00:00:00.000Z',
    };

RentInvoice _inv(String id, String status) => RentInvoice.fromJson({..._json(status: status), 'id': id});

/// Scripted statuses; the last repeats forever so "never paid" can poll on.
/// Optionally fails the first [failFirst] fetches (transient-error path).
class _ScriptedRentRepo implements RentRepository {
  _ScriptedRentRepo(this.statuses, {this.failFirst = 0});

  final List<String> statuses;
  final int failFirst;
  int calls = 0;

  @override
  Future<RentInvoice> fetchInvoice(String invoiceId) async {
    final n = calls++;
    if (n < failFirst) throw Exception('network down');
    return _inv(invoiceId, statuses[n < statuses.length ? n : statuses.length - 1]);
  }

  @override
  Future<RentPage> listMine({String? cursor, int limit = 20}) => throw UnimplementedError();

  @override
  Future<RazorpayOrder> payRent(String invoiceId) => throw UnimplementedError();

  @override
  Future<Uint8List> downloadReceipt(String invoiceId) => throw UnimplementedError();
}

void main() {
  Future<void> noSleep(Duration _) async {}
  DateTime frozenNow() => DateTime(2026);

  group('RentInvoice.fromJson', () {
    test('parses fields and status flags', () {
      final due = RentInvoice.fromJson(_json(status: 'DUE'));
      expect(due.amount.value, 1200000);
      expect(due.periodLabel, 'July 2026');
      expect(due.isDue, isTrue);
      expect(due.isUnpaid, isTrue);
      expect(due.paidAt, isNull);

      final overdue = RentInvoice.fromJson(_json(status: 'OVERDUE', daysOverdue: 3));
      expect(overdue.isOverdue, isTrue);
      expect(overdue.daysOverdue, 3);

      final paid = RentInvoice.fromJson(_json(status: 'PAID', paidAt: '2026-07-10T00:00:00.000Z'));
      expect(paid.isPaid, isTrue);
      expect(paid.isUnpaid, isFalse);
      expect(paid.paidAt, isNotNull);
    });
  });

  group('currentRentInvoice', () {
    test('returns null when there are no invoices', () {
      expect(currentRentInvoice(const []), isNull);
    });

    test('prefers the most recent UNPAID invoice (the one to act on)', () {
      // List is newest-due-first; the newest is paid but an older one is overdue.
      final list = [_inv('a', 'PAID'), _inv('b', 'OVERDUE'), _inv('c', 'PAID')];
      expect(currentRentInvoice(list)?.id, 'b');
    });

    test('falls back to the newest invoice when all are paid', () {
      final list = [_inv('a', 'PAID'), _inv('b', 'PAID')];
      expect(currentRentInvoice(list)?.id, 'a');
    });
  });

  group('RentPaymentPoller', () {
    test('flips DUE -> PAID only when the server reports PAID', () async {
      final repo = _ScriptedRentRepo(['DUE', 'DUE', 'PAID']);
      final poller = RentPaymentPoller(repo, 'inv1', initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

      await poller.start();

      expect(poller.state, isA<RentPaid>());
      expect((poller.state as RentPaid).invoice.isPaid, isTrue);
      expect(repo.calls, 3);
    });

    test('an unpaid invoice never self-confirms — it times out for a retry', () async {
      final repo = _ScriptedRentRepo(['DUE']); // always due
      var t = DateTime(2026);
      DateTime advancingNow() {
        final current = t;
        t = t.add(const Duration(seconds: 40)); // 90s window elapses quickly
        return current;
      }

      final poller = RentPaymentPoller(
        repo,
        'inv1',
        initialInterval: Duration.zero,
        timeout: const Duration(seconds: 90),
        now: advancingNow,
        sleep: noSleep,
      );

      await poller.start();

      expect(poller.state, isA<RentTimedOut>());
      expect(poller.state, isNot(isA<RentPaid>()));
      expect((poller.state as RentTimedOut).lastSeen?.isUnpaid, isTrue);
    });

    test('a PAID that lands after a transient failure still confirms', () async {
      final repo = _ScriptedRentRepo(['DUE', 'PAID'], failFirst: 1);
      final poller = RentPaymentPoller(repo, 'inv1', initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

      await poller.start();

      expect(poller.state, isA<RentPaid>());
    });
  });
}
