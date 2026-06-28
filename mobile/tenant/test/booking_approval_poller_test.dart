import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_core/roomadda_core.dart';
import 'package:roomadda_tenant/features/booking/application/booking_approval_poller.dart';
import 'package:roomadda_tenant/features/booking/data/booking_repository.dart';
import 'package:roomadda_tenant/features/booking/domain/booking.dart';

Booking _booking(String status) => Booking(
      id: 'b1',
      bedId: 'bed1',
      listingId: 'l1',
      status: status,
      tokenAmount: const Paise(500000),
      createdAt: DateTime(2026),
    );

/// Scripted statuses; last entry repeats (so a "never accepted" case polls on).
class _ScriptedRepo implements BookingRepository {
  _ScriptedRepo(this.statuses);
  final List<String> statuses;
  int calls = 0;

  @override
  Future<Booking> fetchStatus(String bookingId) async {
    final n = calls++;
    return _booking(statuses[n < statuses.length ? n : statuses.length - 1]);
  }

  @override
  Future<Booking> createHold(String bedId) => throw UnimplementedError();
  @override
  Future<Booking> createHoldForRoom(String roomId, {DateTime? moveInDate, String? mealPlan}) => throw UnimplementedError();
  @override
  Future<RazorpayOrder> createOnlinePayment(String bookingId, int tokenPaise) => throw UnimplementedError();
  @override
  Future<BookingPage> listMine({String? cursor, int limit = 20}) => throw UnimplementedError();
  @override
  Future<CancelResult> cancel(String bookingId, {String? reason}) => throw UnimplementedError();
  @override
  Future<Uint8List> downloadReceipt(String bookingId) => throw UnimplementedError();
}

void main() {
  Future<void> noSleep(Duration _) async {}
  DateTime frozenNow() => DateTime(2026);

  test('waits while PENDING_APPROVAL, then becomes ready when the host accepts', () async {
    final repo = _ScriptedRepo(['PENDING_APPROVAL', 'PENDING_APPROVAL', 'TOKEN_PENDING']);
    final poller = BookingApprovalPoller(repo, 'b1', initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<ApprovalReady>());
    expect((poller.state as ApprovalReady).booking.isTokenPending, isTrue);
    expect(repo.calls, 3); // it kept waiting until acceptance — never opened payment early
  });

  test('an unaccepted request times out into a retryable state (not ready)', () async {
    final repo = _ScriptedRepo(['PENDING_APPROVAL']); // never accepted
    var t = DateTime(2026);
    DateTime advancingNow() {
      final current = t;
      t = t.add(const Duration(seconds: 60));
      return current;
    }

    final poller = BookingApprovalPoller(
      repo, 'b1',
      initialInterval: Duration.zero,
      timeout: const Duration(seconds: 120),
      now: advancingNow,
      sleep: noSleep,
    );

    await poller.start();

    expect(poller.state, isA<ApprovalTimedOut>());
    expect(poller.state, isNot(isA<ApprovalReady>()));
  });

  test('a declined/expired request is terminal', () async {
    final repo = _ScriptedRepo(['PENDING_APPROVAL', 'EXPIRED']);
    final poller = BookingApprovalPoller(repo, 'b1', initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<ApprovalDeclined>());
  });
}
