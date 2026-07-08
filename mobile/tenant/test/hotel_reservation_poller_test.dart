import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_core/roomadda_core.dart';
import 'package:roomadda_tenant/features/hotel/application/hotel_reservation_poller.dart';
import 'package:roomadda_tenant/features/hotel/data/hotel_repository.dart';
import 'package:roomadda_tenant/features/hotel/domain/hotel.dart';

HotelReservation _reservation(String status) => HotelReservation(
      id: 'r1',
      listingId: 'h1',
      categoryId: 'c1',
      status: status,
      checkIn: DateTime(2026, 7, 10),
      checkOut: DateTime(2026, 7, 13),
      nights: 3,
      perNight: const Paise(500000),
      roomTotal: const Paise(1500000),
      tokenAmount: const Paise(1500000),
      createdAt: DateTime(2026, 7, 9),
      // The server only ever mints a QR on CONFIRMED; model the same here.
      qrCodeToken: status == 'CONFIRMED' ? 'hqr_abc123' : null,
    );

/// Scripts a sequence of server statuses; the last entry repeats forever so a
/// "never confirms" scenario can poll indefinitely. Optionally fails the first
/// [failFirst] fetches to exercise the transient-error path.
class _ScriptedRepo implements HotelRepository {
  _ScriptedRepo(this.statuses, {this.failFirst = 0});

  final List<String> statuses;
  final int failFirst;
  int calls = 0;

  @override
  Future<HotelReservation> fetchStatus(String reservationId) async {
    final n = calls++;
    if (n < failFirst) throw Exception('network down');
    return _reservation(statuses[n < statuses.length ? n : statuses.length - 1]);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

void main() {
  // No-op sleep so the loop runs synchronously; a constant clock never times out.
  Future<void> noSleep(Duration _) async {}
  DateTime frozenNow() => DateTime(2026);

  test('poller flips HELD -> CONFIRMED only when the SERVER confirms', () async {
    final repo = _ScriptedRepo(['HELD', 'HELD', 'CONFIRMED']);
    final poller = HotelReservationPoller(repo, 'r1',
        initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<HotelConfirmed>());
    expect((poller.state as HotelConfirmed).reservation.isConfirmed, isTrue);
    expect((poller.state as HotelConfirmed).reservation.checkInCode, 'hqr_abc123');
    expect(repo.calls, 3);
  });

  test('an always-HELD reservation NEVER self-confirms (times out to retry)', () async {
    // No CONFIRMED status is ever returned — the submitted callback alone must
    // never produce a confirmation.
    final repo = _ScriptedRepo(['HELD']);
    var t = DateTime(2026);
    DateTime advancingNow() {
      final current = t;
      t = t.add(const Duration(seconds: 40));
      return current;
    }

    final poller = HotelReservationPoller(repo, 'r1',
        initialInterval: Duration.zero,
        timeout: const Duration(seconds: 90),
        now: advancingNow,
        sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<HotelConfirmTimedOut>());
    expect(poller.state, isNot(isA<HotelConfirmed>()));
    expect((poller.state as HotelConfirmTimedOut).lastSeen?.status, 'HELD');
  });

  test('a confirmation that lands after a transient failure still confirms', () async {
    final repo = _ScriptedRepo(['HELD', 'CONFIRMED'], failFirst: 1);
    final poller = HotelReservationPoller(repo, 'r1',
        initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<HotelConfirmed>());
  });

  test('an EXPIRED hold is a terminal non-success', () async {
    final repo = _ScriptedRepo(['HELD', 'EXPIRED']);
    final poller = HotelReservationPoller(repo, 'r1',
        initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<HotelReservationEnded>());
  });

  test('a CANCELLED reservation is terminal', () async {
    final repo = _ScriptedRepo(['HELD', 'CANCELLED']);
    final poller = HotelReservationPoller(repo, 'r1',
        initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<HotelReservationEnded>());
  });

  test('checkAgain re-polls and can confirm after a timeout', () async {
    final repo = _ScriptedRepo(['HELD', 'CONFIRMED']);
    var t = DateTime(2026);
    DateTime jumpyNow() {
      final current = t;
      t = t.add(const Duration(seconds: 200)); // first window already past the deadline
      return current;
    }

    final poller = HotelReservationPoller(repo, 'r1',
        initialInterval: Duration.zero,
        timeout: const Duration(seconds: 90),
        now: jumpyNow,
        sleep: noSleep);

    await poller.start();
    expect(poller.state, isA<HotelConfirmTimedOut>());

    await poller.checkAgain();
    expect(poller.state, isA<HotelConfirmed>());
  });
}
