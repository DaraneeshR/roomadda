import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:roomadda_core/roomadda_core.dart';
import '../data/hotel_repository.dart';
import '../domain/hotel.dart';

/// State of the "Confirming your stay" step. A reservation becomes CONFIRMED ONLY
/// when the SERVER (via the signature-verified Razorpay webhook) says so — the
/// poller never decides it from the SDK success callback (see /CLAUDE.md domain
/// rule #2: the client is untrusted). This mirrors the PG BookingPoller exactly.
sealed class HotelConfirmation {
  const HotelConfirmation();
}

/// Polling in progress. [attempt] is the 1-based poll count (0 before the first).
class HotelPolling extends HotelConfirmation {
  final int attempt;
  const HotelPolling(this.attempt);
}

/// Terminal success: the server confirmed and minted the check-in QR. Carries the
/// now-confirmed reservation so the screen can reveal the QR + receipt.
class HotelConfirmed extends HotelConfirmation {
  final HotelReservation reservation;
  const HotelConfirmed(this.reservation);
}

/// Terminal: the hold lapsed (EXPIRED) or was CANCELLED before the webhook settled.
/// If the guest was charged, the refund is processed automatically.
class HotelReservationEnded extends HotelConfirmation {
  final HotelReservation reservation;
  const HotelReservationEnded(this.reservation);
}

/// Non-terminal stop: the polling window elapsed with the reservation still HELD.
/// The webhook may still be in flight, so we offer "check again" and NEVER
/// fabricate a confirmation. [lastSeen] is the most recent server snapshot.
class HotelConfirmTimedOut extends HotelConfirmation {
  final HotelReservation? lastSeen;
  const HotelConfirmTimedOut(this.lastSeen);
}

/// Non-terminal stop: the network kept failing through the whole window. Offer a
/// retry; a failed poll surfaces this, never a crash.
class HotelConfirmError extends HotelConfirmation {
  final String message;
  const HotelConfirmError(this.message);
}

/// Polls `GET /v1/hotels/reservations/:id` after the Razorpay SDK reports the
/// payment submitted, until the server reaches a terminal status or the window
/// elapses. Backs off between polls (3s -> capped 12s) and gives up after
/// [timeout] (~90s). `now`/`sleep` are injectable so the loop is unit-testable.
class HotelReservationPoller extends StateNotifier<HotelConfirmation> {
  HotelReservationPoller(
    this._repo,
    this._reservationId, {
    Duration initialInterval = const Duration(seconds: 3),
    Duration maxInterval = const Duration(seconds: 12),
    Duration timeout = const Duration(seconds: 90),
    double backoffFactor = 1.5,
    DateTime Function() now = DateTime.now,
    Future<void> Function(Duration) sleep = _realSleep,
  })  : _initialInterval = initialInterval,
        _maxInterval = maxInterval,
        _timeout = timeout,
        _backoffFactor = backoffFactor,
        _now = now,
        _sleep = sleep,
        super(const HotelPolling(0));

  final HotelRepository _repo;
  final String _reservationId;
  final Duration _initialInterval;
  final Duration _maxInterval;
  final Duration _timeout;
  final double _backoffFactor;
  final DateTime Function() _now;
  final Future<void> Function(Duration) _sleep;

  bool _disposed = false;
  bool _running = false;

  static Future<void> _realSleep(Duration d) => Future<void>.delayed(d);

  /// Begin polling. Re-entry is ignored while a loop is active; use [checkAgain]
  /// to start a fresh window after a timeout or error.
  Future<void> start() async {
    if (_running || _disposed) return;
    _running = true;
    try {
      await _runLoop();
    } finally {
      _running = false;
    }
  }

  /// Re-poll after a non-terminal stop (timeout/error): the webhook may have
  /// landed since. Opens a fresh polling window.
  Future<void> checkAgain() => start();

  Future<void> _runLoop() async {
    final deadline = _now().add(_timeout);
    var interval = _initialInterval;
    var attempt = 0;
    HotelReservation? lastSeen;
    String? lastError;

    while (!_disposed) {
      attempt++;
      _safeSet(HotelPolling(attempt));

      try {
        final reservation = await _repo.fetchStatus(_reservationId);
        if (_disposed) return;
        lastSeen = reservation;
        lastError = null;
        final terminal = _classify(reservation);
        if (terminal != null) {
          _safeSet(terminal);
          return;
        }
      } catch (e) {
        // A single failed poll never crashes the flow — note it and keep trying
        // until the deadline, then surface a retry state.
        lastError = apiExceptionFrom(e).message;
      }

      if (_disposed) return;
      if (!_now().isBefore(deadline)) {
        _safeSet(lastSeen != null
            ? HotelConfirmTimedOut(lastSeen)
            : HotelConfirmError(lastError ?? 'Could not reach the server.'));
        return;
      }

      await _sleep(interval);
      interval = _nextInterval(interval);
    }
  }

  /// Map a server snapshot to a terminal state, or null if still HELD. CONFIRMED
  /// is the ONLY path to success — no local signal can produce it.
  HotelConfirmation? _classify(HotelReservation r) {
    if (r.isConfirmed) return HotelConfirmed(r);
    if (r.isEnded) return HotelReservationEnded(r);
    return null;
  }

  Duration _nextInterval(Duration current) {
    final next = (current.inMilliseconds * _backoffFactor).round();
    return Duration(milliseconds: math.min(next, _maxInterval.inMilliseconds));
  }

  void _safeSet(HotelConfirmation next) {
    if (!_disposed) state = next;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// One poller per reservation id. `autoDispose` tears the poller down (cancelling
/// the loop) once the screen stops watching it — i.e. on leave. The poll starts as
/// soon as the screen watches it, which it does only after payment is submitted.
final hotelReservationPollerProvider = StateNotifierProvider.autoDispose
    .family<HotelReservationPoller, HotelConfirmation, String>((ref, reservationId) {
  final poller = HotelReservationPoller(ref.read(hotelRepositoryProvider), reservationId);
  poller.start();
  return poller;
});
