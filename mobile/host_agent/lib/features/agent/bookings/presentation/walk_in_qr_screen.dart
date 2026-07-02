import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/agent_widgets.dart';
import '../application/booking_providers.dart';
import '../application/walk_in_poller.dart';
import '../domain/agent_booking.dart';

/// The agent walk-in: show the Razorpay pay QR for the USER to scan on their OWN
/// device, then wait for confirmation. The booking flips to CONFIRMED ONLY when
/// the server (verified webhook) reports it — surfaced here by polling THIS
/// booking's own status (see [WalkInPoller]). The agent NEVER pays and the screen
/// NEVER self-confirms from any local signal.
class WalkInQrScreen extends ConsumerWidget {
  const WalkInQrScreen({super.key, required this.result});

  final WalkInBookingResult result;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final confirmation = ref.watch(walkInPollerProvider(result.bookingId));
    final confirmed = confirmation is WalkInConfirmed;

    return Scaffold(
      appBar: AppBar(title: const Text('Walk-in payment')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
        children: [
          if (confirmed)
            _ConfirmedBlock(result: result)
          else
            _AwaitingBlock(result: result, confirmation: confirmation),
        ],
      ),
    );
  }
}

class _AwaitingBlock extends ConsumerWidget {
  const _AwaitingBlock({required this.result, required this.confirmation});

  final WalkInBookingResult result;
  final WalkInConfirmation confirmation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return Column(
      children: [
        Text('Ask the tenant to scan & pay', style: text.titleLarge, textAlign: TextAlign.center),
        const SizedBox(height: 4),
        Text('₹ token: ${result.tokenAmount.format()}', style: text.bodySmall),
        const SizedBox(height: 20),
        Center(
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.card,
              borderRadius: AppRadii.cardBorder,
              border: Border.all(color: AppColors.hairline),
            ),
            child: QrImageView(
              data: result.payUrl,
              version: QrVersions.auto,
              size: 220,
              backgroundColor: AppColors.card,
              // A scan failure must never crash the screen.
              errorStateBuilder: (context, error) => const SizedBox(
                width: 220,
                height: 220,
                child: Center(child: Text('Could not render the QR. Retry the walk-in.', textAlign: TextAlign.center)),
              ),
            ),
          ),
        ),
        const SizedBox(height: 24),
        _statusRow(context, confirmation, ref, result.bookingId),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: const BoxDecoration(color: AppColors.paperAlt, borderRadius: AppRadii.cardBorder),
          child: const Row(
            children: [
              Icon(Icons.lock_outline, size: 18, color: AppColors.mutedInk),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'The tenant pays on their own phone. This confirms automatically once the payment is verified — you never collect cash or tap “pay”.',
                  style: TextStyle(color: AppColors.mutedInk, fontSize: 13),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _statusRow(BuildContext context, WalkInConfirmation c, WidgetRef ref, String bookingId) {
    return switch (c) {
      WalkInPolling() => const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
            SizedBox(width: 12),
            Text('Waiting for payment…'),
          ],
        ),
      WalkInTimedOut() => _retry(
          context,
          ref,
          bookingId,
          'Still waiting. The payment may take a moment — check again.',
        ),
      WalkInPollError(:final message) => _retry(context, ref, bookingId, message),
      WalkInConfirmed() => const SizedBox.shrink(),
    };
  }

  Widget _retry(BuildContext context, WidgetRef ref, String bookingId, String message) {
    return Column(
      children: [
        Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.mutedInk)),
        const SizedBox(height: 12),
        SecondaryButton(
          label: 'Check again',
          icon: Icons.refresh,
          onPressed: () => ref.read(walkInPollerProvider(bookingId).notifier).checkAgain(),
        ),
      ],
    );
  }
}

class _ConfirmedBlock extends StatelessWidget {
  const _ConfirmedBlock({required this.result});
  final WalkInBookingResult result;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      children: [
        const SizedBox(height: 12),
        const Icon(Icons.check_circle, size: 72, color: AppColors.verified),
        const SizedBox(height: 12),
        Text('Payment received', style: text.titleLarge),
        const SizedBox(height: 4),
        Text('The booking is confirmed. Tagged as an Agent Walk-In.',
            textAlign: TextAlign.center, style: text.bodySmall),
        const SizedBox(height: 8),
        const AgentPill(label: 'Agent Walk-In', color: AppColors.agentVisited),
        const SizedBox(height: 24),
        PrimaryButton(label: 'Done', icon: Icons.check, expand: true, onPressed: () => Navigator.of(context).pop()),
      ],
    );
  }
}
