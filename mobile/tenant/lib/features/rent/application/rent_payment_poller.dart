import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/rent_repository.dart';
import '../domain/rent_invoice.dart';

/// State of the "Confirming your rent payment" step. The invoice becomes PAID
/// ONLY when the server (via the signature-verified Razorpay webhook) says so —
/// the poller never decides it from the Razorpay SDK callback (RENT IS MONEY;
/// see /CLAUDE.md domain rule #2: the client is untrusted). Mirrors the token
/// BookingPoller: the only terminal success is PAID; otherwise we keep polling.
sealed class RentConfirmation {
  const RentConfirmation();
}

class RentPolling extends RentConfirmation {
  final int attempt;
  const RentPolling(this.attempt);
}

/// Terminal success: the server marked the invoice PAID.
class RentPaid extends RentConfirmation {
  final RentInvoice invoice;
  const RentPaid(this.invoice);
}

/// Non-terminal stop: the window elapsed still unpaid — the webhook may still be
/// in flight, so we offer "check again" and NEVER fabricate a PAID.
class RentTimedOut extends RentConfirmation {
  final RentInvoice? lastSeen;
  const RentTimedOut(this.lastSeen);
}

/// Non-terminal stop: the network kept failing through the whole window.
class RentPollError extends RentConfirmation {
  final String message;
  const RentPollError(this.message);
}

/// Polls `GET /v1/rent/:id` after the Razorpay SDK reports the payment submitted,
/// until the server reports PAID or the window elapses. Backs off between polls;
/// timings and the `now`/`sleep` hooks are injectable for deterministic tests.
class RentPaymentPoller extends StateNotifier<RentConfirmation> {
  RentPaymentPoller(
    this._repo,
    this._invoiceId, {
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
        super(const RentPolling(0));

  final RentRepository _repo;
  final String _invoiceId;
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

  /// Re-poll after a non-terminal stop: the webhook may have landed since.
  Future<void> checkAgain() => start();

  Future<void> _runLoop() async {
    final deadline = _now().add(_timeout);
    var interval = _initialInterval;
    var attempt = 0;
    RentInvoice? lastSeen;
    String? lastError;

    while (!_disposed) {
      attempt++;
      _safeSet(RentPolling(attempt));
      try {
        final invoice = await _repo.fetchInvoice(_invoiceId);
        if (_disposed) return;
        lastSeen = invoice;
        lastError = null;
        if (invoice.isPaid) {
          _safeSet(RentPaid(invoice));
          return;
        }
      } catch (e) {
        lastError = apiExceptionFrom(e).message;
      }

      if (_disposed) return;
      if (!_now().isBefore(deadline)) {
        _safeSet(lastSeen != null
            ? RentTimedOut(lastSeen)
            : RentPollError(lastError ?? 'Could not reach the server.'));
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

  void _safeSet(RentConfirmation next) {
    if (!_disposed) state = next;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// One poller per invoice id; starts when the screen watches it (after payment is
/// submitted) and is auto-disposed on leave.
final rentPaymentPollerProvider = StateNotifierProvider.autoDispose
    .family<RentPaymentPoller, RentConfirmation, String>((ref, invoiceId) {
  final poller = RentPaymentPoller(ref.read(rentRepositoryProvider), invoiceId);
  poller.start();
  return poller;
});
