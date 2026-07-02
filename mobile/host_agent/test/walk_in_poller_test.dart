import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/agent/bookings/application/walk_in_poller.dart';
import 'package:roomadda_host_agent/features/agent/bookings/domain/agent_booking.dart';

/// A scripted server-truth source. The last entry repeats forever so a
/// "never confirms" scenario polls indefinitely. Optionally fails the first
/// [failFirst] reads to exercise the transient-error path.
class _ScriptedStatus {
  _ScriptedStatus(this.statuses, {this.failFirst = 0});

  final List<WalkInServerStatus> statuses;
  final int failFirst;
  int calls = 0;

  Future<WalkInServerStatus> next() async {
    final n = calls++;
    if (n < failFirst) throw Exception('network down');
    return statuses[n < statuses.length ? n : statuses.length - 1];
  }
}

void main() {
  Future<void> noSleep(Duration _) async {}
  DateTime frozenNow() => DateTime(2026);

  const pending = WalkInServerStatus.pending;
  const confirmed = WalkInServerStatus.confirmed;

  test('flips to CONFIRMED only when the SERVER reports confirmed', () async {
    final source = _ScriptedStatus([pending, pending, confirmed]);
    final poller = WalkInPoller(source.next, initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<WalkInConfirmed>());
    expect(source.calls, 3); // confirmed only after the server said so
  });

  test('never self-confirms: an always-pending server times out, never confirmed', () async {
    final source = _ScriptedStatus([pending]);
    var t = DateTime(2026);
    DateTime advancingNow() {
      final current = t;
      t = t.add(const Duration(seconds: 60)); // each read jumps 60s → 180s window elapses
      return current;
    }

    final poller = WalkInPoller(
      source.next,
      initialInterval: Duration.zero,
      timeout: const Duration(seconds: 180),
      now: advancingNow,
      sleep: noSleep,
    );

    await poller.start();

    expect(poller.state, isA<WalkInTimedOut>());
    expect(poller.state, isNot(isA<WalkInConfirmed>())); // no local/app-side confirm path
  });

  test('reads the SPECIFIC booking: a sibling booking confirming does not confirm this one', () async {
    // The poller now watches ONE booking's own status source (GET /agent/bookings/:id).
    // A different in-scope booking (same agent/zone) confirming must never leak in —
    // this is exactly the race the old dashboard-counter source had.
    final sibling = _ScriptedStatus([confirmed]); // an in-scope booking already CONFIRMED
    final thisBooking = _ScriptedStatus([pending, pending, confirmed]);
    final poller = WalkInPoller(thisBooking.next, initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<WalkInConfirmed>());
    expect(thisBooking.calls, 3); // confirmed only when THIS booking's own status said so
    expect(sibling.calls, 0); // the sibling's confirmation was never consulted
  });

  test('a confirmation that lands after a transient failure still confirms', () async {
    final source = _ScriptedStatus([pending, confirmed], failFirst: 1);
    final poller = WalkInPoller(source.next, initialInterval: Duration.zero, now: frozenNow, sleep: noSleep);

    await poller.start();

    expect(poller.state, isA<WalkInConfirmed>());
  });

  test('network failing through the whole window yields a retryable error, not a confirm', () async {
    final source = _ScriptedStatus([pending], failFirst: 100);
    var t = DateTime(2026);
    DateTime advancingNow() {
      final current = t;
      t = t.add(const Duration(seconds: 60));
      return current;
    }

    final poller = WalkInPoller(
      source.next,
      initialInterval: Duration.zero,
      timeout: const Duration(seconds: 180),
      now: advancingNow,
      sleep: noSleep,
    );

    await poller.start();

    expect(poller.state, isA<WalkInPollError>());
  });

  test('checkAgain re-polls and can confirm after a timeout', () async {
    final source = _ScriptedStatus([pending, confirmed]);
    var t = DateTime(2026);
    DateTime jumpyNow() {
      final current = t;
      t = t.add(const Duration(seconds: 400)); // first window times out immediately
      return current;
    }

    final poller = WalkInPoller(
      source.next,
      initialInterval: Duration.zero,
      timeout: const Duration(seconds: 180),
      now: jumpyNow,
      sleep: noSleep,
    );

    await poller.start();
    expect(poller.state, isA<WalkInTimedOut>());

    await poller.checkAgain();
    expect(poller.state, isA<WalkInConfirmed>());
  });
}
