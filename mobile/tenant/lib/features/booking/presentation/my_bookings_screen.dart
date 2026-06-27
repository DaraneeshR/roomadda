import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/my_bookings_controller.dart';
import '../domain/booking.dart';

/// The tenant's bookings, newest first. The server returns each listing masked
/// or unmasked per booking status, so a CONFIRMED row shows the real name while
/// others show the alias — we render whatever the server sends, nothing more.
class MyBookingsScreen extends ConsumerWidget {
  const MyBookingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(myBookingsControllerProvider);
    final controller = ref.read(myBookingsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('My bookings')),
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: _buildBody(context, state, controller),
      ),
    );
  }

  Widget _buildBody(BuildContext context, MyBookingsState state, MyBookingsController controller) {
    if (state.isLoading && state.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.isEmpty) {
      return _MessageList(
        message: state.error ?? 'You have no bookings yet.',
        onRetry: state.error != null ? controller.refresh : null,
      );
    }

    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: state.items.length + 1,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        if (index == state.items.length) {
          return _ListFooter(state: state, controller: controller);
        }
        return _BookingTile(booking: state.items[index]);
      },
    );
  }
}

class _BookingTile extends StatelessWidget {
  const _BookingTile({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final listing = booking.listing;
    final title = listing?.displayName ?? 'Bed ${booking.bedId}';
    final where = listing == null ? '' : '${listing.areaLabel}, ${listing.city}';
    final visual = _statusVisual(booking.status);

    return ListTile(
      leading: Icon(visual.icon, color: visual.color),
      title: Text(title),
      subtitle: Text([where, booking.tokenAmount.format()].where((s) => s.isNotEmpty).join(' · ')),
      trailing: Text(visual.label, style: TextStyle(color: visual.color, fontWeight: FontWeight.w600)),
    );
  }
}

class _ListFooter extends StatelessWidget {
  const _ListFooter({required this.state, required this.controller});

  final MyBookingsState state;
  final MyBookingsController controller;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          if (state.error != null) ...[
            Text(state.error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 8),
          ],
          if (state.isLoadingMore)
            const CircularProgressIndicator()
          else if (state.hasMore)
            OutlinedButton(onPressed: controller.loadMore, child: const Text('Load more')),
        ],
      ),
    );
  }
}

/// Scrollable so pull-to-refresh works even when the list is empty or errored.
class _MessageList extends StatelessWidget {
  const _MessageList({required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 120),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Text(message, textAlign: TextAlign.center),
                if (onRetry != null) ...[
                  const SizedBox(height: 16),
                  FilledButton(onPressed: onRetry, child: const Text('Try again')),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _StatusVisual {
  final String label;
  final IconData icon;
  final Color color;
  const _StatusVisual(this.label, this.icon, this.color);
}

_StatusVisual _statusVisual(String status) => switch (status) {
      'CONFIRMED' => const _StatusVisual('Confirmed', Icons.check_circle, Colors.green),
      'COMPLETED' => const _StatusVisual('Completed', Icons.task_alt, Colors.green),
      'TOKEN_PENDING' => const _StatusVisual('Pending', Icons.hourglass_bottom, Colors.orange),
      'INITIATED' => const _StatusVisual('Initiated', Icons.hourglass_empty, Colors.orange),
      'EXPIRED' => const _StatusVisual('Expired', Icons.timer_off_outlined, Colors.grey),
      'CANCELLED' => const _StatusVisual('Cancelled', Icons.cancel_outlined, Colors.grey),
      _ => _StatusVisual(status, Icons.help_outline, Colors.grey),
    };
