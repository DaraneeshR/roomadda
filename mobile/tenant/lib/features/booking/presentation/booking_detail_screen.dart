import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/booking_detail_provider.dart';
import '../data/booking_repository.dart';
import '../domain/booking.dart';

const _cancellable = {'PENDING_APPROVAL', 'TOKEN_PENDING', 'CONFIRMED'};

/// Full booking detail: status, payment history, and the in-policy actions
/// (cancel + contact host). Cancellation refund is computed/applied server-side.
class BookingDetailScreen extends ConsumerWidget {
  const BookingDetailScreen({super.key, required this.bookingId});

  final String bookingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(bookingByIdProvider(bookingId));
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('Booking detail')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(apiExceptionFrom(e).message)),
        data: (booking) => _Detail(booking: booking),
      ),
    );
  }
}

class _Detail extends ConsumerWidget {
  const _Detail({required this.booking});
  final Booking booking;

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Cancel booking?'),
        content: const Text(
          'A refund is applied per policy: full more than 7 days before move-in, '
          '50% 3–7 days before, none within 3 days.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep booking')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Cancel booking')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final result = await ref.read(bookingRepositoryProvider).cancel(booking.id, reason: 'tenant cancelled');
      messenger.showSnackBar(SnackBar(content: Text('Cancelled. Refund: ${result.refund.format()}')));
      ref.invalidate(bookingByIdProvider(booking.id));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    }
  }

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

  void _contactHost(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('In-app chat with your host is coming soon.')),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final listing = booking.listing;
    final moveIn = booking.moveInDate;
    final payment = booking.payment;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(
          children: [
            Expanded(child: Text(listing?.displayName ?? 'Booking', style: text.titleLarge)),
            _StatusChip(status: booking.status),
          ],
        ),
        const SizedBox(height: 16),

        _section('Stay', [
          if (moveIn != null) _row('Move-in', '${moveIn.day}/${moveIn.month}/${moveIn.year}'),
          if (booking.mealPlan != null) _row('Meal plan', booking.mealPlan!),
          if (booking.hostName != null) _row('Host', booking.hostName!),
          if (listing != null && !listing.masked && listing.fullAddress != null) _row('Address', listing.fullAddress!),
        ]),

        _section('Payment', [
          _row('Token', booking.tokenAmount.format()),
          if (booking.monthlyRent != null) _row('Monthly rent', booking.monthlyRent!.format()),
          if (booking.deposit != null) _row('Deposit', booking.deposit!.format()),
          if (payment != null) _row('Method', payment.method),
          if (payment?.online != null) _row('Online payment', payment!.online!.status),
          if (payment?.cash != null) _row('Cash', payment!.cash!.status),
          if (payment == null) _row('Payment', 'Not started'),
        ]),

        const SizedBox(height: 12),
        if (booking.isConfirmed)
          PrimaryButton(
            label: 'Download receipt',
            icon: Icons.download,
            expand: true,
            onPressed: () => _downloadReceipt(context, ref),
          ),
        const SizedBox(height: 12),
        SecondaryButton(label: 'Contact host', icon: Icons.chat_bubble_outline, expand: true, onPressed: () => _contactHost(context)),
        if (_cancellable.contains(booking.status)) ...[
          const SizedBox(height: 12),
          TextButton(
            onPressed: () => _cancel(context, ref),
            child: const Text('Cancel booking', style: TextStyle(color: AppColors.accent)),
          ),
        ],
      ],
    );
  }

  Widget _section(String title, List<Widget> rows) {
    final visible = rows.where((w) => w is! SizedBox).toList();
    if (visible.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        Text(title, style: AppTypography.eyebrow),
        const SizedBox(height: 6),
        ...rows,
        const SizedBox(height: 8),
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

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'CONFIRMED' => ('Confirmed', AppColors.verified),
      'COMPLETED' => ('Completed', AppColors.verified),
      'TOKEN_PENDING' => ('Payment pending', AppColors.sponsored),
      'PENDING_APPROVAL' => ('Awaiting host', AppColors.sponsored),
      'EXPIRED' => ('Expired', AppColors.mutedInk),
      'CANCELLED' => ('Cancelled', AppColors.mutedInk),
      _ => (status, AppColors.mutedInk),
    };
    return DecoratedBox(
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: AppRadii.pillBorder),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 12)),
      ),
    );
  }
}
