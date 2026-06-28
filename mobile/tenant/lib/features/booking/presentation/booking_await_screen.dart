import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/booking_approval_poller.dart';

/// Request-to-Book waiting room. Polls until the host accepts (server moves the
/// booking to TOKEN_PENDING) and then jumps to payment — payment is NEVER opened
/// before acceptance. Terminal/expired/timeout states are handled explicitly.
class BookingAwaitScreen extends ConsumerStatefulWidget {
  const BookingAwaitScreen({super.key, required this.bookingId});
  final String bookingId;

  @override
  ConsumerState<BookingAwaitScreen> createState() => _BookingAwaitScreenState();
}

class _BookingAwaitScreenState extends ConsumerState<BookingAwaitScreen> {
  @override
  Widget build(BuildContext context) {
    final provider = bookingApprovalPollerProvider(widget.bookingId);

    // Host accepted -> go straight to payment (replace so Back doesn't return here).
    ref.listen(provider, (_, next) {
      if (next is ApprovalReady) {
        context.pushReplacement('/tenant/booking/${widget.bookingId}/pay');
      }
    });

    final state = ref.watch(provider);
    void checkAgain() => ref.read(provider.notifier).checkAgain();

    return Scaffold(
      appBar: AppBar(title: const Text('Request sent')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: switch (state) {
          ApprovalWaiting() => const _Busy(message: 'Waiting for the host to accept your request…\nThis can take up to 24 hours.'),
          ApprovalReady() => const _Busy(message: 'Accepted! Opening payment…'),
          ApprovalDeclined() => _Action(
              icon: Icons.cancel_outlined,
              color: AppColors.mutedInk,
              message: 'This request was declined or expired before it was accepted.',
              buttonLabel: 'Back to my bookings',
              onPressed: () => context.go('/tenant'),
            ),
          ApprovalTimedOut() => _Action(
              icon: Icons.hourglass_bottom,
              color: AppColors.sponsored,
              message: "We haven't heard back yet. The host still has time to accept — you can check again, or come back from My Bookings.",
              buttonLabel: 'Check again',
              onPressed: checkAgain,
            ),
          ApprovalError(:final message) => _Action(
              icon: Icons.wifi_off,
              color: AppColors.accent,
              message: message,
              buttonLabel: 'Check again',
              onPressed: checkAgain,
            ),
        },
      ),
    );
  }
}

class _Busy extends StatelessWidget {
  const _Busy({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(message, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.color, required this.message, required this.buttonLabel, required this.onPressed});
  final IconData icon;
  final Color color;
  final String message;
  final String buttonLabel;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 56, color: color),
          const SizedBox(height: 16),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 24),
          SecondaryButton(label: buttonLabel, onPressed: onPressed),
        ],
      ),
    );
  }
}
