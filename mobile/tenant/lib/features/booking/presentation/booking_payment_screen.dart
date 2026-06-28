import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:share_plus/share_plus.dart';

import 'package:roomadda_core/roomadda_core.dart';
import '../application/booking_poller.dart';
import '../data/booking_repository.dart';
import '../domain/booking.dart';

/// Token payment for a booking that is already TOKEN_PENDING (Instant Book, or a
/// Request-to-Book the host has accepted). The Razorpay success callback means
/// "payment submitted", NOT confirmed — confirmation is owned by the poller,
/// which watches the server for the webhook-driven CONFIRMED (see /CLAUDE.md #2).
enum _Stage { loading, idle, preparing, paying, paymentFailed, submitted }

class BookingPaymentScreen extends ConsumerStatefulWidget {
  const BookingPaymentScreen({super.key, required this.bookingId});

  final String bookingId;

  @override
  ConsumerState<BookingPaymentScreen> createState() => _BookingPaymentScreenState();
}

class _BookingPaymentScreenState extends ConsumerState<BookingPaymentScreen> {
  late final Razorpay _razorpay;
  Booking? _booking;
  _Stage _stage = _Stage.loading;
  String? _message;

  @override
  void initState() {
    super.initState();
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _onExternalWallet);
    _load();
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final booking = await ref.read(bookingRepositoryProvider).fetchStatus(widget.bookingId);
      if (!mounted) return;
      setState(() {
        _booking = booking;
        _stage = booking.isConfirmed ? _Stage.submitted : _Stage.idle;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _stage = _Stage.paymentFailed;
        _message = apiExceptionFrom(e).message;
      });
    }
  }

  Future<void> _start() async {
    final booking = _booking;
    if (booking == null) return;
    setState(() {
      _stage = _Stage.preparing;
      _message = null;
    });
    try {
      final order = await ref.read(bookingRepositoryProvider).createOnlinePayment(booking.id, booking.tokenAmount.value);
      if (!mounted) return;
      setState(() => _stage = _Stage.paying);
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

  void _onPaymentSuccess(PaymentSuccessResponse response) {
    if (!mounted) return;
    setState(() => _stage = _Stage.submitted); // submitted, NOT confirmed
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
            if (_booking != null) Text('Token: ${_booking!.tokenAmount.format()}'),
            const SizedBox(height: 24),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    return switch (_stage) {
      _Stage.loading => const _BusyView(message: 'Loading your booking…'),
      _Stage.idle => _ActionView(
          message: 'Pay the token online to secure this bed.',
          buttonLabel: 'Pay token online',
          onPressed: _start,
        ),
      _Stage.preparing => const _BusyView(message: 'Setting up your payment…'),
      _Stage.paying => const _BusyView(message: 'Waiting for the payment to complete…'),
      _Stage.paymentFailed => _ActionView(
          icon: Icons.error_outline,
          iconColor: AppColors.accent,
          message: _message ?? 'Payment failed.',
          buttonLabel: 'Try again',
          onPressed: _start,
        ),
      _Stage.submitted => _ConfirmationView(bookingId: widget.bookingId),
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
          iconColor: AppColors.sponsored,
          message: 'Your hold expired before the payment was confirmed. '
              'If you were charged, it will be refunded automatically.',
        ),
      ConfirmationPaymentFailed() => const _ActionView(
          icon: Icons.error_outline,
          iconColor: AppColors.accent,
          message: 'The payment failed. Please try booking again.',
        ),
      ConfirmationTimedOut() => _ActionView(
          icon: Icons.hourglass_bottom,
          iconColor: AppColors.sponsored,
          message: "We haven't received confirmation yet. The payment may still "
              'be settling — you can check again in a moment.',
          buttonLabel: 'Check again',
          onPressed: checkAgain,
        ),
      ConfirmationError(:final message) => _ActionView(
          icon: Icons.wifi_off,
          iconColor: AppColors.accent,
          message: message,
          buttonLabel: 'Check again',
          onPressed: checkAgain,
        ),
    };
  }
}

/// Success: the server confirmed, so the booking now carries the host name and
/// the unmasked listing. Shows the Booking ID + host + move-in and offers the
/// downloadable receipt.
class _ConfirmedView extends ConsumerWidget {
  const _ConfirmedView({required this.booking});

  final Booking booking;

  Future<void> _downloadReceipt(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await ref.read(bookingRepositoryProvider).downloadReceipt(booking.id);
      await Share.shareXFiles([
        XFile.fromData(bytes, mimeType: 'application/pdf', name: 'roomadda-receipt-${booking.id}.pdf'),
      ]);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final listing = booking.listing;
    final moveIn = booking.moveInDate;
    return ListView(
      children: [
        const SizedBox(height: 12),
        const Icon(Icons.check_circle, color: AppColors.verified, size: 64),
        const SizedBox(height: 16),
        Text('Booking confirmed', style: text.titleLarge, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        Text('Confirmed by our server.', style: text.bodySmall, textAlign: TextAlign.center),
        const SizedBox(height: 20),
        _row('Booking ID', booking.id),
        if (booking.hostName != null) _row('Host', booking.hostName!),
        if (moveIn != null) _row('Move-in', '${moveIn.day}/${moveIn.month}/${moveIn.year}'),
        _row('Token paid', booking.tokenAmount.format()),
        if (listing != null && !listing.masked) ...[
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(listing.displayName, style: text.titleMedium),
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
        const SizedBox(height: 24),
        PrimaryButton(
          label: 'Download receipt',
          icon: Icons.download,
          expand: true,
          onPressed: () => _downloadReceipt(context, ref),
        ),
        const SizedBox(height: 12),
        SecondaryButton(
          label: 'View my bookings',
          expand: true,
          onPressed: () => context.go('/tenant'),
        ),
      ],
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.mutedInk)),
          Flexible(child: Text(value, textAlign: TextAlign.right)),
        ],
      ),
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
          PrimaryButton(label: buttonLabel!, onPressed: onPressed),
        ],
      ],
    );
  }
}
