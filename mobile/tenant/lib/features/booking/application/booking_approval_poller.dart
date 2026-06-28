import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/booking_repository.dart';
import '../domain/booking.dart';

/// State of the "waiting for the host to accept" step (Request-to-Book). The
/// booking only becomes payable when the SERVER moves it PENDING_APPROVAL ->
/// TOKEN_PENDING (host accept); the app never self-approves.
sealed class ApprovalState {
  const ApprovalState();
}

class ApprovalWaiting extends ApprovalState {
  final int attempt;
  const ApprovalWaiting(this.attempt);
}

/// Host accepted — the booking is now TOKEN_PENDING (payment unlocked).
class ApprovalReady extends ApprovalState {
  final Booking booking;
  const ApprovalReady(this.booking);
}

/// Terminal non-success: the request expired or was cancelled before acceptance.
class ApprovalDeclined extends ApprovalState {
  final Booking booking;
  const ApprovalDeclined(this.booking);
}

/// The polling window elapsed still awaiting approval — offer "check again".
class ApprovalTimedOut extends ApprovalState {
  final Booking? lastSeen;
  const ApprovalTimedOut(this.lastSeen);
}

class ApprovalError extends ApprovalState {
  final String message;
  const ApprovalError(this.message);
}

/// Polls `GET /v1/bookings/:id` until the host accepts (TOKEN_PENDING) or the
/// request reaches a terminal state. Same injectable timing/`now`/`sleep` hooks
/// as the confirmation poller so it is unit-tested deterministically.
class BookingApprovalPoller extends StateNotifier<ApprovalState> {
  BookingApprovalPoller(
    this._repo,
    this._bookingId, {
    Duration initialInterval = const Duration(seconds: 3),
    Duration maxInterval = const Duration(seconds: 15),
    Duration timeout = const Duration(seconds: 120),
    double backoffFactor = 1.5,
    DateTime Function() now = DateTime.now,
    Future<void> Function(Duration) sleep = _realSleep,
  })  : _initialInterval = initialInterval,
        _maxInterval = maxInterval,
        _timeout = timeout,
        _backoffFactor = backoffFactor,
        _now = now,
        _sleep = sleep,
        super(const ApprovalWaiting(0));

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

  Future<void> start() async {
    if (_running || _disposed) return;
    _running = true;
    try {
      await _runLoop();
    } finally {
      _running = false;
    }
  }

  Future<void> checkAgain() => start();

  Future<void> _runLoop() async {
    final deadline = _now().add(_timeout);
    var interval = _initialInterval;
    var attempt = 0;
    Booking? lastSeen;
    String? lastError;

    while (!_disposed) {
      attempt++;
      _safeSet(ApprovalWaiting(attempt));
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
        lastError = apiExceptionFrom(e).message;
      }

      if (_disposed) return;
      if (!_now().isBefore(deadline)) {
        _safeSet(lastSeen != null
            ? ApprovalTimedOut(lastSeen)
            : ApprovalError(lastError ?? 'Could not reach the server.'));
        return;
      }
      await _sleep(interval);
      interval = _nextInterval(interval);
    }
  }

  ApprovalState? _classify(Booking booking) {
    if (booking.isTokenPending || booking.isConfirmed) return ApprovalReady(booking);
    if (booking.status == 'EXPIRED' || booking.status == 'CANCELLED') return ApprovalDeclined(booking);
    return null; // still PENDING_APPROVAL
  }

  Duration _nextInterval(Duration current) {
    final next = (current.inMilliseconds * _backoffFactor).round();
    return Duration(milliseconds: math.min(next, _maxInterval.inMilliseconds));
  }

  void _safeSet(ApprovalState next) {
    if (!_disposed) state = next;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// One poller per booking id; auto-disposed when the await screen leaves.
final bookingApprovalPollerProvider = StateNotifierProvider.autoDispose
    .family<BookingApprovalPoller, ApprovalState, String>((ref, bookingId) {
  final poller = BookingApprovalPoller(ref.read(bookingRepositoryProvider), bookingId);
  poller.start();
  return poller;
});
