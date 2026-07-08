import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:share_plus/share_plus.dart';

import 'package:roomadda_core/roomadda_core.dart';
import '../application/hotel_reservation_poller.dart';
import '../data/hotel_repository.dart';
import '../domain/hotel.dart';

/// Pay + confirm a HELD hotel reservation, then show the check-in QR. Mirrors the
/// PG token flow exactly (see /CLAUDE.md domain rule #2): the Razorpay success
/// callback means "submitted", NOT confirmed. Confirmation is owned by the poller,
/// which watches the SERVER for the webhook-driven CONFIRMED (which also mints the
/// QR). A callback alone NEVER confirms; a failed poll retries, never crashes.
enum _Stage { loading, payable, ended, preparing, paying, paymentFailed, submitted }

class HotelReservationScreen extends ConsumerStatefulWidget {
  const HotelReservationScreen({super.key, required this.reservationId});

  final String reservationId;

  @override
  ConsumerState<HotelReservationScreen> createState() => _HotelReservationScreenState();
}

class _HotelReservationScreenState extends ConsumerState<HotelReservationScreen> {
  late final Razorpay _razorpay;
  HotelReservation? _reservation;
  _Stage _stage = _Stage.loading;
  String? _message;
  bool _devHint = false;

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
      final r = await ref.read(hotelRepositoryProvider).fetchStatus(widget.reservationId);
      if (!mounted) return;
      setState(() {
        _reservation = r;
        _stage = r.isConfirmed
            ? _Stage.submitted
            : r.isEnded
                ? _Stage.ended
                : _Stage.payable;
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
    final r = _reservation;
    if (r == null) return;
    setState(() {
      _stage = _Stage.preparing;
      _message = null;
    });
    try {
      final order = await ref.read(hotelRepositoryProvider).createPayment(r.id);
      if (!mounted) return;
      final rzp = order.razorpayOrder;
      if (rzp != null && rzp.isRealCheckout) {
        setState(() => _stage = _Stage.paying);
        _razorpay.open({
          'key': rzp.keyId,
          'order_id': rzp.orderId,
          'amount': rzp.amountPaise,
          'currency': rzp.currency,
          'name': 'RoomAdda',
          'description': 'Hotel booking',
        });
      } else {
        // No reachable gateway (local stub): drop straight into the confirmation
        // poll for the webhook fired by demo:confirm — exactly the web fallback.
        setState(() {
          _devHint = true;
          _stage = _Stage.submitted;
        });
      }
    } catch (e) {
      if (!mounted) return;
      final err = apiExceptionFrom(e);
      // A payment was already initiated — just start polling, don't error out.
      if (err.statusCode == 409 && err.code == 'PAYMENT_EXISTS') {
        setState(() => _stage = _Stage.submitted);
        return;
      }
      setState(() {
        _stage = _Stage.payable;
        _message = err.message;
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
    final r = _reservation;
    return Scaffold(
      appBar: AppBar(title: const Text('Confirm your stay')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (r != null && !r.isConfirmed && !r.isEnded)
              Text.rich(TextSpan(children: [
                const TextSpan(text: 'Pay now: '),
                TextSpan(
                  text: r.tokenAmount.format(),
                  style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.accent),
                ),
                TextSpan(text: '   (${r.nights} night${r.nights == 1 ? '' : 's'})'),
              ])),
            const SizedBox(height: 20),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    return switch (_stage) {
      _Stage.loading => const _Busy(message: 'Loading your reservation…'),
      _Stage.payable => _Action(
          message: 'Pay the full stay online to confirm your room. '
              "You'll be confirmed once the payment settles.",
          buttonLabel: 'Pay & confirm',
          onPressed: _start,
          error: _message,
        ),
      _Stage.ended => const _Action(
          icon: Icons.timer_off_outlined,
          iconColor: AppColors.sponsored,
          message: 'This reservation ended before it was confirmed. '
              'If you were charged, it will be refunded automatically.',
        ),
      _Stage.preparing => const _Busy(message: 'Setting up your payment…'),
      _Stage.paying => const _Busy(message: 'Complete the payment in the Razorpay window…'),
      _Stage.paymentFailed => _Action(
          icon: Icons.error_outline,
          iconColor: AppColors.accent,
          message: _message ?? 'Payment failed.',
          buttonLabel: 'Try again',
          onPressed: _start,
        ),
      _Stage.submitted => _ConfirmationView(reservationId: widget.reservationId, devHint: _devHint),
    };
  }
}

/// Renders the poll-driven confirmation state. The poller starts as soon as this
/// is watched and is auto-disposed when the screen leaves (the loop cancels).
class _ConfirmationView extends ConsumerWidget {
  const _ConfirmationView({required this.reservationId, required this.devHint});

  final String reservationId;
  final bool devHint;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(hotelReservationPollerProvider(reservationId));
    void checkAgain() => ref.read(hotelReservationPollerProvider(reservationId).notifier).checkAgain();

    return switch (state) {
      HotelPolling() => _Busy(
          message: 'Confirming your booking…\nThis is settled by our server, not your device.',
          footer: devHint ? _DevConfirmHint(reservationId: reservationId) : null,
        ),
      HotelConfirmed(:final reservation) => _ConfirmedView(reservation: reservation),
      HotelReservationEnded() => const _Action(
          icon: Icons.timer_off_outlined,
          iconColor: AppColors.sponsored,
          message: 'The hold lapsed or the reservation was cancelled before it was confirmed. '
              'If you were charged, it will be refunded automatically.',
        ),
      HotelConfirmTimedOut() => _Action(
          icon: Icons.hourglass_bottom,
          iconColor: AppColors.sponsored,
          message: "We haven't received confirmation yet. The payment may still be "
              'settling — you can check again in a moment.',
          buttonLabel: 'Check again',
          onPressed: checkAgain,
          footer: devHint ? _DevConfirmHint(reservationId: reservationId) : null,
        ),
      HotelConfirmError(:final message) => _Action(
          icon: Icons.wifi_off,
          iconColor: AppColors.accent,
          message: message,
          buttonLabel: 'Check again',
          onPressed: checkAgain,
        ),
    };
  }
}

/// Success: the server confirmed (verified webhook) and minted the check-in QR.
/// Shows the QR, the stay summary, a downloadable receipt, and the cancellation
/// path. The QR appears ONLY because the server sent `qrCodeToken` post-CONFIRMED.
class _ConfirmedView extends ConsumerStatefulWidget {
  const _ConfirmedView({required this.reservation});

  final HotelReservation reservation;

  @override
  ConsumerState<_ConfirmedView> createState() => _ConfirmedViewState();
}

class _ConfirmedViewState extends ConsumerState<_ConfirmedView> {
  bool _downloading = false;
  String? _cancelResult;

  HotelReservation get _r => widget.reservation;

  Future<void> _downloadReceipt() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _downloading = true);
    try {
      final bytes = await ref.read(hotelRepositoryProvider).downloadReceipt(_r.id);
      await Share.shareXFiles([
        XFile.fromData(bytes, mimeType: 'application/pdf', name: 'roomadda-hotel-receipt-${_r.id}.pdf'),
      ]);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  Future<void> _cancel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel this reservation?'),
        content: const Text('Any eligible refund is processed to your original payment method.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep it')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Yes, cancel')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final result = await ref
          .read(hotelRepositoryProvider)
          .cancel(_r.id, reason: 'Cancelled from app');
      if (!mounted) return;
      setState(() {
        _cancelResult = result.refund.value > 0
            ? 'Cancelled. A refund of ${result.refund.format()} is being processed.'
            : 'Cancelled. Any eligible refund will be processed automatically.';
      });
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final code = _r.checkInCode;
    return ListView(
      children: [
        const SizedBox(height: 8),
        const Icon(Icons.check_circle, color: AppColors.verified, size: 64),
        const SizedBox(height: 12),
        Text('Booking confirmed', style: text.titleLarge, textAlign: TextAlign.center),
        const SizedBox(height: 4),
        Text('Confirmed by our server — your room is secured.',
            style: text.bodySmall, textAlign: TextAlign.center),
        const SizedBox(height: 20),

        // Check-in QR — minted only on the webhook-driven CONFIRMED.
        if (code != null)
          Center(
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: AppShadows.card),
              child: Column(
                children: [
                  QrImageView(
                    data: code,
                    version: QrVersions.auto,
                    size: 200,
                    backgroundColor: Colors.white,
                    eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Color(0xFF0F172A)),
                    dataModuleStyle: const QrDataModuleStyle(dataModuleShape: QrDataModuleShape.square, color: Color(0xFF0F172A)),
                  ),
                  const SizedBox(height: 8),
                  Text(code, style: text.bodySmall?.copyWith(fontFamily: 'monospace', color: AppColors.mutedInk)),
                  const SizedBox(height: 4),
                  Text('Show this at the front desk to check in.',
                      style: text.bodySmall, textAlign: TextAlign.center),
                ],
              ),
            ),
          )
        else
          Text('Your check-in code is being generated…', style: text.bodySmall, textAlign: TextAlign.center),

        const SizedBox(height: 20),
        _row('Reservation ID', _r.id),
        _row('Check-in', _fmt(_r.checkIn)),
        _row('Check-out', _fmt(_r.checkOut)),
        _row('Nights', '${_r.nights}'),
        _row('Per night', _r.perNight.format()),
        _row('Total paid', _r.roomTotal.format()),

        const SizedBox(height: 24),
        PrimaryButton(
          label: _downloading ? 'Preparing…' : 'Download receipt',
          icon: Icons.download,
          expand: true,
          onPressed: _downloading ? null : _downloadReceipt,
        ),
        const SizedBox(height: 12),
        if (_cancelResult != null)
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: AppColors.paperAlt, borderRadius: BorderRadius.circular(12)),
            child: Text(_cancelResult!, style: text.bodyMedium),
          )
        else
          SecondaryButton(label: 'Cancel this reservation', expand: true, onPressed: _cancel),
        const SizedBox(height: 12),
        TextButton(onPressed: () => context.go('/tenant'), child: const Text('Browse more hotels')),
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

  static String _fmt(DateTime d) => '${d.day}/${d.month}/${d.year}';
}

class _Busy extends StatelessWidget {
  const _Busy({required this.message, this.footer});

  final String message;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const CircularProgressIndicator(),
        const SizedBox(height: 16),
        Text(message, textAlign: TextAlign.center),
        if (footer != null) ...[const SizedBox(height: 20), footer!],
      ],
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({
    required this.message,
    this.icon,
    this.iconColor,
    this.buttonLabel,
    this.onPressed,
    this.error,
    this.footer,
  });

  final String message;
  final IconData? icon;
  final Color? iconColor;
  final String? buttonLabel;
  final VoidCallback? onPressed;
  final String? error;
  final Widget? footer;

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
        if (error != null) ...[
          const SizedBox(height: 12),
          Text(error!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.accent)),
        ],
        if (buttonLabel != null && onPressed != null) ...[
          const SizedBox(height: 24),
          PrimaryButton(label: buttonLabel!, expand: true, onPressed: onPressed),
        ],
        if (footer != null) ...[const SizedBox(height: 20), footer!],
      ],
    );
  }
}

/// Local-dev hint: no live gateway, so fire the signed webhook to settle the
/// reservation; the poll above then confirms on its own (exactly the web flow).
class _DevConfirmHint extends StatelessWidget {
  const _DevConfirmHint({required this.reservationId});

  final String reservationId;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.hairlineStrong),
        color: AppColors.paperAlt,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Local dev — no live gateway', style: text.labelLarge),
          const SizedBox(height: 4),
          Text('Fire the signed webhook to settle this reservation:', style: text.bodySmall),
          const SizedBox(height: 6),
          SelectableText(
            'pnpm --filter @roomadda/backend demo:confirm $reservationId',
            style: text.bodySmall?.copyWith(fontFamily: 'monospace'),
          ),
        ],
      ),
    );
  }
}
