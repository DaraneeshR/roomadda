import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/agent_booking.dart';

/// State of the walk-in "waiting for payment" step. A walk-in becomes CONFIRMED
/// ONLY when the server (via the signature-verified Razorpay webhook) reports it —
/// mirrored here through the agent dashboard's confirmed-this-month count rising.
/// The poller NEVER decides confirmation from any local/app-side signal
/// (/CLAUDE.md rule #2: the client is untrusted; the agent cannot move money).
sealed class WalkInConfirmation {
  const WalkInConfirmation();
}

/// Polling in progress. [attempt] is the 1-based poll count.
class WalkInPolling extends WalkInConfirmation {
  final int attempt;
  const WalkInPolling(this.attempt);
}

/// Terminal success: the server confirmed (webhook settled the token).
class WalkInConfirmed extends WalkInConfirmation {
  const WalkInConfirmed();
}

/// Non-terminal stop: the active polling window elapsed with the booking still
/// pending. The webhook may still land, so we offer "check again" and NEVER
/// fabricate a confirmation.
class WalkInTimedOut extends WalkInConfirmation {
  const WalkInTimedOut();
}

/// Non-terminal stop: the network kept failing through the whole window. Offer a
/// retry; a failed poll surfaces this, never a crash.
class WalkInPollError extends WalkInConfirmation {
  final String message;
  const WalkInPollError(this.message);
}

/// Polls a SERVER-TRUTH status source until the walk-in confirms or the window
/// elapses. Structurally identical to the tenant `BookingPoller`: it only reaches
/// [WalkInConfirmed] when [statusSource] returns [WalkInServerStatus.confirmed] —
/// there is no code path that confirms from a local callback. Backs off between
/// polls and gives up after [timeout]; timings + `now`/`sleep` are injectable so
/// the loop is deterministically unit-testable.
class WalkInPoller extends StateNotifier<WalkInConfirmation> {
  WalkInPoller(
    this._statusSource, {
    Duration initialInterval = const Duration(seconds: 3),
    Duration maxInterval = const Duration(seconds: 12),
    Duration timeout = const Duration(seconds: 180),
    double backoffFactor = 1.5,
    DateTime Function() now = DateTime.now,
    Future<void> Function(Duration) sleep = _realSleep,
  })  : _initialInterval = initialInterval,
        _maxInterval = maxInterval,
        _timeout = timeout,
        _backoffFactor = backoffFactor,
        _now = now,
        _sleep = sleep,
        super(const WalkInPolling(0));

  /// Returns the current SERVER status of the walk-in. The only source of truth —
  /// derived from the webhook-driven dashboard count, never a client decision.
  final Future<WalkInServerStatus> Function() _statusSource;

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
  /// to open a fresh window after a timeout/error.
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
    String? lastError;

    while (!_disposed) {
      attempt++;
      _safeSet(WalkInPolling(attempt));

      try {
        final status = await _statusSource();
        if (_disposed) return;
        lastError = null;
        // The ONLY route to confirmation: the server reports it.
        if (status == WalkInServerStatus.confirmed) {
          _safeSet(const WalkInConfirmed());
          return;
        }
      } catch (e) {
        // A single failed poll never crashes the flow — keep trying until the
        // deadline, then surface a retry state.
        lastError = apiExceptionFrom(e).message;
      }

      if (_disposed) return;
      if (!_now().isBefore(deadline)) {
        _safeSet(lastError != null ? WalkInPollError(lastError) : const WalkInTimedOut());
        return;
      }

      await _sleep(interval);
      interval = _nextInterval(interval);
    }
  }

  Duration _nextInterval(Duration current) {
    final next = (current.inMilliseconds * _backoffFactor).round();
    return Duration(milliseconds: math.min(next, _maxInterval.inMilliseconds));
  }

  void _safeSet(WalkInConfirmation next) {
    if (!_disposed) state = next;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
