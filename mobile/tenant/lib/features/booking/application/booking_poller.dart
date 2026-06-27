import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:roomadda_core/roomadda_core.dart';
import '../data/booking_repository.dart';
import '../domain/booking.dart';

/// State of the "Confirming your booking" step. The booking becomes CONFIRMED
/// ONLY when the server (via the signature-verified Razorpay webhook) says so —
/// the poller never decides it from the SDK success callback (see /CLAUDE.md
/// domain rule #2: the client is untrusted).
sealed class BookingConfirmation {
  const BookingConfirmation();
}

/// Polling in progress. [attempt] is the 1-based poll count (0 before the first).
class ConfirmationPolling extends BookingConfirmation {
  final int attempt;
  const ConfirmationPolling(this.attempt);
}

/// Terminal success: the server confirmed. Carries the now-unmasked booking so
/// the screen can reveal `listing.actualName` / `fullAddress`.
class ConfirmationConfirmed extends BookingConfirmation {
  final Booking booking;
  const ConfirmationConfirmed(this.booking);
}

/// Terminal: the hold lapsed (server status EXPIRED) before the webhook settled.
class ConfirmationHoldExpired extends BookingConfirmation {
  final Booking booking;
  const ConfirmationHoldExpired(this.booking);
}

/// Terminal: the server recorded the online payment leg as FAILED.
class ConfirmationPaymentFailed extends BookingConfirmation {
  final Booking booking;
  const ConfirmationPaymentFailed(this.booking);
}

/// Non-terminal stop: the polling window elapsed with the booking still pending.
/// The webhook may still be in flight, so we offer "check again" and NEVER
/// fabricate a confirmation. [lastSeen] is the most recent server snapshot.
class ConfirmationTimedOut extends BookingConfirmation {
  final Booking? lastSeen;
  const ConfirmationTimedOut(this.lastSeen);
}

/// Non-terminal stop: the network kept failing through the whole window. Offer a
/// retry; a failed poll surfaces this, never a crash.
class ConfirmationError extends BookingConfirmation {
  final String message;
  const ConfirmationError(this.message);
}

/// Polls `GET /v1/bookings/:id` after the Razorpay SDK reports the payment as
/// submitted, until the server reaches a terminal status or the window elapses.
/// Backs off between polls (default 3s -> capped) and gives up after [timeout]
/// (~90s). Timings and the `now`/`sleep` hooks are injectable so the loop can be
/// unit-tested deterministically.
class BookingPoller extends StateNotifier<BookingConfirmation> {
  BookingPoller(
    this._repo,
    this._bookingId, {
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
        super(const ConfirmationPolling(0));

  final BookingRepository _repo;
  final String _bookingId;
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
    Booking? lastSeen;
    String? lastError;

    while (!_disposed) {
      attempt++;
      _safeSet(ConfirmationPolling(attempt));

      try {
        final booking = await _repo.fetchStatus(_bookingId);
        if (_disposed) return;
        lastSeen = booking;
        lastError = null;
        final terminal = _classify(booking);
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
            ? ConfirmationTimedOut(lastSeen)
            : ConfirmationError(lastError ?? 'Could not reach the server.'));
        return;
      }

      await _sleep(interval);
      interval = _nextInterval(interval);
    }
  }

  /// Map a server snapshot to a terminal state, or null if still pending.
  BookingConfirmation? _classify(Booking booking) {
    if (booking.isConfirmed) return ConfirmationConfirmed(booking);
    if (booking.isExpired) return ConfirmationHoldExpired(booking);
    if (booking.isPaymentFailed) return ConfirmationPaymentFailed(booking);
    return null;
  }

  Duration _nextInterval(Duration current) {
    final next = (current.inMilliseconds * _backoffFactor).round();
    return Duration(milliseconds: math.min(next, _maxInterval.inMilliseconds));
  }

  void _safeSet(BookingConfirmation next) {
    if (!_disposed) state = next;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// One poller per booking id. `autoDispose` tears the poller down (cancelling the
/// loop) once the screen stops watching it — i.e. on leave. The poll starts as
/// soon as the screen watches it, which it does only after payment is submitted.
final bookingPollerProvider = StateNotifierProvider.autoDispose
    .family<BookingPoller, BookingConfirmation, String>((ref, bookingId) {
  final poller = BookingPoller(ref.read(bookingRepositoryProvider), bookingId);
  poller.start();
  return poller;
});
