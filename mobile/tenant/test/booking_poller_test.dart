import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_core/roomadda_core.dart';
import 'package:roomadda_tenant/features/booking/application/booking_poller.dart';
import 'package:roomadda_tenant/features/booking/data/booking_repository.dart';
import 'package:roomadda_tenant/features/booking/domain/booking.dart';

Booking _booking(String status, {PaymentSummary? payment}) => Booking(
      id: 'b1',
      bedId: 'bed1',
      listingId: 'l1',
      status: status,
      tokenAmount: const Paise(500000),
      createdAt: DateTime(2026),
      payment: payment,
    );

/// Returns a scripted sequence of statuses; the last entry repeats forever so a
/// "never confirms" scenario can poll indefinitely. Optionally fails the first
/// [failFirst] fetches to exercise the transient-error path.
class _ScriptedRepo implements BookingRepository {
  _ScriptedRepo(this.statuses, {this.failFirst = 0});

  final List<String> statuses;
  final int failFirst;
  int calls = 0;

  @override
  Future<Booking> fetchStatus(String bookingId) async {
    final n = calls++;
    if (n < failFirst) throw Exception('network down');
    final status = statuses[n < statuses.length ? n : statuses.length - 1];
    return _booking(status);
  }

  @override
  Future<Booking> createHold(String bedId) => throw UnimplementedError();

  @override
  Future<Booking> createHoldForRoom(String roomId, {DateTime? moveInDate, String? mealPlan}) =>
      throw UnimplementedError();

  @override
  Future<RazorpayOrder> createOnlinePayment(String bookingId, int tokenPaise) =>
      throw UnimplementedError();

  @override
  Future<BookingPage> listMine({String? cursor, int limit = 20}) => throw UnimplementedError();

  @override
  Future<CancelResult> cancel(String bookingId, {String? reason}) => throw UnimplementedError();

  @override
  Future<Uint8List> downloadReceipt(String bookingId) => throw UnimplementedError();
}

void main() {
  // No-op sleep so the loop runs synchronously; a constant clock never times out.
  Future<void> noSleep(Duration _) async {}
  DateTime frozenNow() => DateTime(2026);

  test('poller flips TOKEN_PENDING -> CONFIRMED when the API confirms', () async {
    final repo = _ScriptedRepo(['TOKEN_PENDING', 'TOKEN_PENDING', 'CONFIRMED']);
    final poller = BookingPoller(
      repo,
      'b1',
      initialInterval: Duration.zero,
      now: frozenNow,
      sleep: noSleep,
    );

    await poller.start();

    expect(poller.state, isA<ConfirmationConfirmed>());
    expect((poller.state as ConfirmationConfirmed).booking.isConfirmed, isTrue);
    expect(repo.calls, 3);
  });

  test('a timeout yields the retry (timed-out) state, never a false success', () async {
    // Always pending: it must NOT self-confirm.
    final repo = _ScriptedRepo(['TOKEN_PENDING']);
    // Advancing clock: each read jumps 40s, so the 90s window elapses quickly.
    var t = DateTime(2026);
    DateTime advancingNow() {
      final current = t;
      t = t.add(const Duration(seconds: 40));
      return current;
    }

    final poller = BookingPoller(
      repo,
      'b1',
      initialInterval: Duration.zero,
      timeout: const Duration(seconds: 90),
      now: advancingNow,
      sleep: noSleep,
    );

    await poller.start();

    expect(poller.state, isA<ConfirmationTimedOut>());
    expect(poller.state, isNot(isA<ConfirmationConfirmed>()));
    expect((poller.state as ConfirmationTimedOut).lastSeen?.status, 'TOKEN_PENDING');
  });

  test('a confirmation that lands after a transient failure still confirms', () async {
    final repo = _ScriptedRepo(['TOKEN_PENDING', 'CONFIRMED'], failFirst: 1);
    final poller = BookingPoller(
      repo,
      'b1',
      initialInterval: Duration.zero,
      now: frozenNow,
      sleep: noSleep,
    );

    await poller.start();

    expect(poller.state, isA<ConfirmationConfirmed>());
  });

  test('an EXPIRED hold is a terminal non-success', () async {
    final repo = _ScriptedRepo(['TOKEN_PENDING', 'EXPIRED']);
    final poller = BookingPoller(
      repo,
      'b1',
      initialInterval: Duration.zero,
      now: frozenNow,
      sleep: noSleep,
    );

    await poller.start();

    expect(poller.state, isA<ConfirmationHoldExpired>());
  });

  test('a server-reported FAILED payment is terminal', () async {
    final poller = BookingPoller(
      _FailedPaymentRepo(),
      'b1',
      initialInterval: Duration.zero,
      now: frozenNow,
      sleep: noSleep,
    );

    await poller.start();

    expect(poller.state, isA<ConfirmationPaymentFailed>());
  });

  test('checkAgain re-polls and can confirm after a timeout', () async {
    final repo = _ScriptedRepo(['TOKEN_PENDING', 'CONFIRMED']);
    // First window times out immediately (deadline already passed).
    var t = DateTime(2026);
    DateTime jumpyNow() {
      final current = t;
      t = t.add(const Duration(seconds: 200));
      return current;
    }

    final poller = BookingPoller(
      repo,
      'b1',
      initialInterval: Duration.zero,
      timeout: const Duration(seconds: 90),
      now: jumpyNow,
      sleep: noSleep,
    );

    await poller.start();
    expect(poller.state, isA<ConfirmationTimedOut>());

    // Next read returns CONFIRMED; a fresh window confirms it.
    await poller.checkAgain();
    expect(poller.state, isA<ConfirmationConfirmed>());
  });
}

/// Returns a booking whose payment leg the server marks FAILED.
class _FailedPaymentRepo implements BookingRepository {
  @override
  Future<Booking> fetchStatus(String bookingId) async => _booking(
        'TOKEN_PENDING',
        payment: const PaymentSummary(
          method: 'RAZORPAY',
          status: 'FAILED',
          online: OnlinePaymentLeg(status: 'FAILED'),
        ),
      );

  @override
  Future<Booking> createHold(String bedId) => throw UnimplementedError();

  @override
  Future<Booking> createHoldForRoom(String roomId, {DateTime? moveInDate, String? mealPlan}) =>
      throw UnimplementedError();

  @override
  Future<RazorpayOrder> createOnlinePayment(String bookingId, int tokenPaise) =>
      throw UnimplementedError();

  @override
  Future<BookingPage> listMine({String? cursor, int limit = 20}) => throw UnimplementedError();

  @override
  Future<CancelResult> cancel(String bookingId, {String? reason}) => throw UnimplementedError();

  @override
  Future<Uint8List> downloadReceipt(String bookingId) => throw UnimplementedError();
}
