import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import 'package:roomadda_core/roomadda_core.dart';
import '../application/booking_poller.dart';
import '../data/booking_repository.dart';
import '../domain/booking.dart';

/// Local UI stage for the synchronous part of the flow (hold + open Razorpay).
/// Once payment is SUBMITTED, confirmation is owned by [bookingPollerProvider] —
/// this screen renders that provider's state and never decides CONFIRMED itself
/// (see /CLAUDE.md domain rule #2).
enum _Stage { idle, preparing, paying, paymentFailed, submitted }

class BookingPaymentScreen extends ConsumerStatefulWidget {
  const BookingPaymentScreen({super.key, required this.bedId});

  final String bedId;

  @override
  ConsumerState<BookingPaymentScreen> createState() => _BookingPaymentScreenState();
}

class _BookingPaymentScreenState extends ConsumerState<BookingPaymentScreen> {
  late final Razorpay _razorpay;
  Booking? _booking;
  String? _bookingId;
  _Stage _stage = _Stage.idle;
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
      _stage = _Stage.preparing;
      _message = null;
    });
    try {
      final repo = ref.read(bookingRepositoryProvider);
      final booking = await repo.createHold(widget.bedId);
      final order = await repo.createOnlinePayment(booking.id, booking.tokenAmount.value);
      if (!mounted) return;
      setState(() {
        _booking = booking;
        _bookingId = booking.id;
        _stage = _Stage.paying;
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
        _stage = _Stage.paymentFailed;
        _message = apiExceptionFrom(e).message;
      });
    }
  }

  /// The Razorpay SDK success callback is UI-ONLY: it means "payment submitted",
  /// NOT "booking confirmed". We hand off to the poller, which watches the server
  /// for the webhook-driven transition to CONFIRMED.
  void _onPaymentSuccess(PaymentSuccessResponse response) {
    if (!mounted) return;
    setState(() => _stage = _Stage.submitted);
  }

  void _onPaymentError(PaymentFailureResponse response) {
    if (!mounted) return;
    setState(() {
      _stage = _Stage.paymentFailed;
      _message = 'Payment failed or was cancelled.';
    });
  }

  void _onExternalWallet(ExternalWalletResponse response) {}

  @override
  Widget build(BuildContext context) {
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
            ],
            const SizedBox(height: 24),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    return switch (_stage) {
      _Stage.idle => _ActionView(
          message: 'Pay the token online to secure this bed.',
          buttonLabel: 'Pay token online',
          onPressed: _start,
        ),
      _Stage.preparing => const _BusyView(message: 'Setting up your payment…'),
      _Stage.paying => const _BusyView(message: 'Waiting for the payment to complete…'),
      _Stage.paymentFailed => _ActionView(
          icon: Icons.error_outline,
          iconColor: Colors.red,
          message: _message ?? 'Payment failed.',
          buttonLabel: 'Try again',
          onPressed: _start,
        ),
      _Stage.submitted => _ConfirmationView(bookingId: _bookingId!),
    };
  }
}

/// Renders the poll-driven confirmation state. The poller starts as soon as this
/// is watched and is auto-disposed when the screen leaves.
class _ConfirmationView extends ConsumerWidget {
  const _ConfirmationView({required this.bookingId});

  final String bookingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(bookingPollerProvider(bookingId));
    void checkAgain() => ref.read(bookingPollerProvider(bookingId).notifier).checkAgain();

    return switch (state) {
      ConfirmationPolling() =>
        const _BusyView(message: 'Confirming your booking…\nThis only takes a moment.'),
      ConfirmationConfirmed(:final booking) => _ConfirmedView(booking: booking),
      ConfirmationHoldExpired() => const _ActionView(
          icon: Icons.timer_off_outlined,
          iconColor: Colors.orange,
          message: 'Your hold expired before the payment was confirmed. '
              'If you were charged, it will be refunded automatically.',
        ),
      ConfirmationPaymentFailed() => const _ActionView(
          icon: Icons.error_outline,
          iconColor: Colors.red,
          message: 'The payment failed. Please try booking again.',
        ),
      ConfirmationTimedOut() => _ActionView(
          icon: Icons.hourglass_bottom,
          iconColor: Colors.orange,
          message: "We haven't received confirmation yet. The payment may still "
              'be settling — you can check again in a moment.',
          buttonLabel: 'Check again',
          onPressed: checkAgain,
        ),
      ConfirmationError(:final message) => _ActionView(
          icon: Icons.wifi_off,
          iconColor: Colors.red,
          message: message,
          buttonLabel: 'Check again',
          onPressed: checkAgain,
        ),
    };
  }
}

/// Success: the server confirmed, so the listing arrives UNMASKED. We can now
/// reveal the real name and full address — present only because the server
/// returns them post-CONFIRMED.
class _ConfirmedView extends StatelessWidget {
  const _ConfirmedView({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final listing = booking.listing;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(Icons.check_circle, color: Colors.green, size: 64),
        const SizedBox(height: 16),
        Text('Booking confirmed', style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        const Text('Confirmed by our server.', textAlign: TextAlign.center),
        if (listing != null && !listing.masked) ...[
          const SizedBox(height: 24),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(listing.displayName, style: Theme.of(context).textTheme.titleMedium),
                  if (listing.fullAddress != null) ...[
                    const SizedBox(height: 4),
                    Text(listing.fullAddress!),
                  ],
                  const SizedBox(height: 4),
                  Text('${listing.areaLabel}, ${listing.city}'),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _BusyView extends StatelessWidget {
  const _BusyView({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const CircularProgressIndicator(),
        const SizedBox(height: 16),
        Text(message, textAlign: TextAlign.center),
      ],
    );
  }
}

class _ActionView extends StatelessWidget {
  const _ActionView({
    required this.message,
    this.icon,
    this.iconColor,
    this.buttonLabel,
    this.onPressed,
  });

  final String message;
  final IconData? icon;
  final Color? iconColor;
  final String? buttonLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (icon != null) ...[
          Icon(icon, color: iconColor, size: 56),
          const SizedBox(height: 16),
        ],
        Text(message, textAlign: TextAlign.center),
        if (buttonLabel != null && onPressed != null) ...[
          const SizedBox(height: 24),
          FilledButton(onPressed: onPressed, child: Text(buttonLabel!)),
        ],
      ],
    );
  }
}
