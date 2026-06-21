import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import '../../../core/network/api_exception.dart';
import '../data/booking_repository.dart';
import '../domain/booking.dart';

enum _Phase { idle, holding, paying, awaitingConfirmation, confirmed, failed }

class BookingPaymentScreen extends ConsumerStatefulWidget {
  const BookingPaymentScreen({super.key, required this.bedId});

  final String bedId;

  @override
  ConsumerState<BookingPaymentScreen> createState() => _BookingPaymentScreenState();
}

class _BookingPaymentScreenState extends ConsumerState<BookingPaymentScreen> {
  late final Razorpay _razorpay;
  Booking? _booking;
  _Phase _phase = _Phase.idle;
  String? _message;

  @override
  void initState() {
    super.initState();
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _onExternalWallet);
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _phase = _Phase.holding;
      _message = null;
    });
    try {
      final repo = ref.read(bookingRepositoryProvider);
      final booking = await repo.createHold(widget.bedId);
      final order = await repo.createOnlinePayment(booking.id, booking.tokenAmount.value);
      if (!mounted) return;
      setState(() {
        _booking = booking;
        _phase = _Phase.paying;
      });
      _razorpay.open({
        'key': order.keyId,
        'order_id': order.orderId,
        'amount': order.amountPaise,
        'currency': order.currency,
        'name': 'RoomAdda',
        'description': 'Booking token',
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.failed;
        _message = apiExceptionFrom(e).message;
      });
    }
  }

  /// The Razorpay SDK success callback is UI-ONLY. It NEVER confirms the booking
  /// — the server webhook does. We move to "awaiting confirmation" and poll the
  /// backend for the real status (see /CLAUDE.md: payment truth = webhook).
  void _onPaymentSuccess(PaymentSuccessResponse response) {
    setState(() {
      _phase = _Phase.awaitingConfirmation;
      _message = 'Payment received. Confirming with our server…';
    });
    unawaited(_pollStatus());
  }

  void _onPaymentError(PaymentFailureResponse response) {
    setState(() {
      _phase = _Phase.failed;
      _message = 'Payment failed or was cancelled.';
    });
  }

  void _onExternalWallet(ExternalWalletResponse response) {}

  Future<void> _pollStatus() async {
    final id = _booking?.id;
    if (id == null) return;
    final repo = ref.read(bookingRepositoryProvider);
    for (var attempt = 0; attempt < 5; attempt++) {
      await Future<void>.delayed(const Duration(seconds: 2));
      try {
        final updated = await repo.fetchStatus(id);
        if (!mounted) return;
        setState(() => _booking = updated);
        if (updated.isConfirmed) {
          setState(() {
            _phase = _Phase.confirmed;
            _message = 'Booking confirmed by the server.';
          });
          return;
        }
      } catch (_) {
        // Status endpoint may be unavailable; keep awaiting — never self-confirm.
      }
    }
    if (mounted && _phase != _Phase.confirmed) {
      setState(() => _message = 'Still awaiting server confirmation. Refresh in a moment.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = _phase == _Phase.holding || _phase == _Phase.paying || _phase == _Phase.awaitingConfirmation;
    return Scaffold(
      appBar: AppBar(title: const Text('Token payment')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Bed: ${widget.bedId}'),
            if (_booking != null) ...[
              const SizedBox(height: 8),
              Text('Token: ${_booking!.tokenAmount.format()}'),
              const SizedBox(height: 8),
              Text('Status (from server): ${_booking!.status}'),
            ],
            const SizedBox(height: 16),
            if (_message != null) Text(_message!),
            const SizedBox(height: 16),
            if (busy) const Center(child: CircularProgressIndicator()),
            if (_phase == _Phase.idle || _phase == _Phase.failed)
              FilledButton(onPressed: _start, child: const Text('Pay token online')),
            if (_phase == _Phase.awaitingConfirmation)
              Padding(
                padding: const EdgeInsets.only(top: 16),
                child: OutlinedButton(onPressed: _pollStatus, child: const Text('Refresh status')),
              ),
            if (_phase == _Phase.confirmed)
              const Padding(
                padding: EdgeInsets.only(top: 16),
                child: Icon(Icons.check_circle, color: Colors.green, size: 48),
              ),
          ],
        ),
      ),
    );
  }
}
