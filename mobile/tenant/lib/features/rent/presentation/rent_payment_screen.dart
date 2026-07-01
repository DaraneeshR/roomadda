import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/rent_payment_poller.dart';
import '../application/rent_providers.dart';
import '../data/rent_repository.dart';
import '../domain/rent_invoice.dart';

/// Pay one rent invoice. The Razorpay success callback means "payment
/// submitted", NOT paid — confirmation is owned by the poller, which watches the
/// server for the webhook-driven PAID (RENT IS MONEY; see /CLAUDE.md domain #2).
enum _Stage { loading, idle, preparing, paying, paymentFailed, submitted }

class RentPaymentScreen extends ConsumerStatefulWidget {
  const RentPaymentScreen({super.key, required this.invoiceId});

  final String invoiceId;

  @override
  ConsumerState<RentPaymentScreen> createState() => _RentPaymentScreenState();
}

class _RentPaymentScreenState extends ConsumerState<RentPaymentScreen> {
  late final Razorpay _razorpay;
  RentInvoice? _invoice;
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
      final invoice = await ref.read(rentRepositoryProvider).fetchInvoice(widget.invoiceId);
      if (!mounted) return;
      setState(() {
        _invoice = invoice;
        _stage = invoice.isPaid ? _Stage.submitted : _Stage.idle;
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
    final invoice = _invoice;
    if (invoice == null) return;
    setState(() {
      _stage = _Stage.preparing;
      _message = null;
    });
    try {
      final order = await ref.read(rentRepositoryProvider).payRent(invoice.id);
      if (!mounted) return;
      setState(() => _stage = _Stage.paying);
      _razorpay.open({
        'key': order.keyId,
        'order_id': order.orderId,
        'amount': order.amountPaise,
        'currency': order.currency,
        'name': 'RoomAdda',
        'description': 'Rent · ${invoice.periodLabel}',
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
    setState(() => _stage = _Stage.submitted); // submitted, NOT paid
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
    final invoice = _invoice;
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('Pay rent')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (invoice != null) ...[
              Text(invoice.periodLabel, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(invoice.amount.format(), style: Theme.of(context).textTheme.headlineSmall),
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
      _Stage.loading => const _BusyView(message: 'Loading your invoice…'),
      _Stage.idle => _ActionView(
          message: 'Pay your rent securely online.',
          buttonLabel: 'Pay rent online',
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
      _Stage.submitted => _RentConfirmationView(invoiceId: widget.invoiceId),
    };
  }
}

/// Poll-driven confirmation. The poller starts when watched and is auto-disposed
/// on leave; PAID is reported ONLY when the server's webhook settled the payment.
class _RentConfirmationView extends ConsumerWidget {
  const _RentConfirmationView({required this.invoiceId});

  final String invoiceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(rentPaymentPollerProvider(invoiceId));
    void checkAgain() => ref.read(rentPaymentPollerProvider(invoiceId).notifier).checkAgain();

    return switch (state) {
      RentPolling() => const _BusyView(message: 'Confirming your payment…\nThis only takes a moment.'),
      RentPaid(:final invoice) => _PaidView(invoice: invoice),
      RentTimedOut() => _ActionView(
          icon: Icons.hourglass_bottom,
          iconColor: AppColors.sponsored,
          message: "We haven't received confirmation yet. The payment may still be "
              'settling — you can check again in a moment.',
          buttonLabel: 'Check again',
          onPressed: checkAgain,
        ),
      RentPollError(:final message) => _ActionView(
          icon: Icons.wifi_off,
          iconColor: AppColors.accent,
          message: message,
          buttonLabel: 'Check again',
          onPressed: checkAgain,
        ),
    };
  }
}

class _PaidView extends ConsumerWidget {
  const _PaidView({required this.invoice});

  final RentInvoice invoice;

  Future<void> _downloadReceipt(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await ref.read(rentRepositoryProvider).downloadReceipt(invoice.id);
      await Share.shareXFiles([
        XFile.fromData(bytes, mimeType: 'application/pdf', name: 'roomadda-rent-${invoice.id}.pdf'),
      ]);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return ListView(
      children: [
        const SizedBox(height: 12),
        const Icon(Icons.check_circle, color: AppColors.verified, size: 64),
        const SizedBox(height: 16),
        Text('Rent paid', style: text.titleLarge, textAlign: TextAlign.center),
        const SizedBox(height: 8),
        Text('Confirmed by our server.', style: text.bodySmall, textAlign: TextAlign.center),
        const SizedBox(height: 20),
        _row('Rent month', invoice.periodLabel),
        _row('Amount paid', invoice.amount.format()),
        const SizedBox(height: 24),
        PrimaryButton(
          label: 'Download receipt',
          icon: Icons.download,
          expand: true,
          onPressed: () => _downloadReceipt(context, ref),
        ),
        const SizedBox(height: 12),
        SecondaryButton(
          label: 'Back to home',
          expand: true,
          onPressed: () {
            // Refresh the dashboard rent card to reflect the new PAID state.
            ref.invalidate(rentInvoicesProvider);
            context.go('/tenant');
          },
        ),
      ],
    );
  }

  Widget _row(String label, String value) => Padding(
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
