import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/request_providers.dart';
import '../data/booking_request_repository.dart';
import '../domain/host_booking_request.dart';

/// Incoming bookings. Request-to-Book holds are actionable with a live 24h
/// countdown (accept unlocks the tenant's payment; decline refunds them). Accept
/// NEVER confirms — only the verified webhook does (/CLAUDE.md). Instant bookings
/// show already-confirmed. The tenant's KYC is never shown — only their name.
class BookingRequestsScreen extends ConsumerWidget {
  const BookingRequestsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(bookingRequestsProvider);
    return HostAsync<HostBookingRequestPage>(
      value: async,
      onRetry: () => ref.invalidate(bookingRequestsProvider),
      skeleton: const SkeletonList(count: 4, height: 150),
      data: (page) {
        if (page.items.isEmpty) {
          return const HostEmpty(
            icon: Icons.inbox_outlined,
            message: 'No incoming bookings yet. Requests and instant bookings will appear here.',
          );
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(bookingRequestsProvider),
          child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            itemCount: page.items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (_, i) => _RequestCard(request: page.items[i]),
          ),
        );
      },
    );
  }
}

class _RequestCard extends ConsumerStatefulWidget {
  const _RequestCard({required this.request});
  final HostBookingRequest request;

  @override
  ConsumerState<_RequestCard> createState() => _RequestCardState();
}

class _RequestCardState extends ConsumerState<_RequestCard> {
  bool _busy = false;

  Future<void> _accept() => _run((r) => r.accept(widget.request.bookingId), 'Accepted — payment unlocked for the tenant');

  Future<void> _decline() async {
    final reason = await _askReason();
    if (reason == null) return; // cancelled
    await _run((r) => r.decline(widget.request.bookingId, reason: reason), 'Declined — the tenant is being refunded');
  }

  Future<void> _run(Future<void> Function(BookingRequestRepository repo) action, String okMsg) async {
    setState(() => _busy = true);
    try {
      await action(ref.read(bookingRequestRepositoryProvider));
      ref.invalidate(bookingRequestsProvider);
      ref.invalidate(hostDashboardProvider);
      if (mounted) _snack(okMsg);
    } catch (e) {
      if (mounted) _snack(apiExceptionFrom(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<String?> _askReason() {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Decline booking'),
        content: TextField(
          controller: controller,
          maxLines: 2,
          decoration: const InputDecoration(hintText: 'Reason (optional)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
            child: const Text('Decline'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.request;
    final text = Theme.of(context).textTheme;
    return HostCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(r.tenantName, style: text.titleMedium)),
              if (r.instant)
                const HostPill(label: 'Instant', color: AppColors.verified)
              else if (r.isExpired)
                const HostPill(label: 'Expired', color: AppColors.faintInk)
              else
                const HostPill(label: 'Request', color: AppColors.sponsored),
            ],
          ),
          const SizedBox(height: 4),
          Text('${r.roomName} · Bed ${r.bedLabel}', style: text.bodySmall),
          const SizedBox(height: 10),
          Row(
            children: [
              _Chip(icon: Icons.payments_outlined, label: 'Token ${r.tokenAmount.format()}'),
              const SizedBox(width: 12),
              _Chip(icon: Icons.home_outlined, label: '${r.monthlyRent.format()}/mo'),
            ],
          ),
          if (r.isPending && r.expiresAt != null) ...[
            const SizedBox(height: 10),
            _Countdown(expiresAt: r.expiresAt!),
          ],
          if (r.isPending) ...[
            const SizedBox(height: 14),
            if (_busy)
              const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator()))
            else if (r.isExpired)
              Text('This request window has passed.', style: text.bodySmall)
            else
              Row(
                children: [
                  Expanded(
                    child: SecondaryButton(label: 'Decline', expand: true, onPressed: _decline),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: PrimaryButton(label: 'Accept', expand: true, onPressed: _accept),
                  ),
                ],
              ),
          ],
        ],
      ),
    );
  }
}

/// A live "Xh Ym left" countdown recomputed each second from [expiresAt].
class _Countdown extends StatefulWidget {
  const _Countdown({required this.expiresAt});
  final DateTime expiresAt;

  @override
  State<_Countdown> createState() => _CountdownState();
}

class _CountdownState extends State<_Countdown> {
  late Timer _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final remaining = widget.expiresAt.difference(DateTime.now()).inSeconds;
    final urgent = remaining < 3600;
    return Row(
      children: [
        Icon(Icons.timer_outlined, size: 16, color: urgent ? AppColors.accent : AppColors.mutedInk),
        const SizedBox(width: 6),
        Text(
          formatCountdown(remaining),
          style: TextStyle(
            color: urgent ? AppColors.accent : AppColors.mutedInk,
            fontWeight: FontWeight.w700,
            fontSize: 13,
          ),
        ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: AppColors.mutedInk),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(color: AppColors.mutedInk, fontSize: 13)),
      ],
    );
  }
}
