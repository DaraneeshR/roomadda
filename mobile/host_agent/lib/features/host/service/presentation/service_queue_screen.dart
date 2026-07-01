import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../application/service_providers.dart';
import '../domain/host_service_request.dart';

/// Host service queue — escalated-first (server-ordered), then newest. A rollup
/// header shows open / escalated / mean resolution time. Tap a ticket to
/// acknowledge / note / resolve. There is NO delete (a host can never delete a
/// request), and tenant KYC is never shown.
class ServiceQueueScreen extends ConsumerWidget {
  const ServiceQueueScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(serviceQueueProvider);
    return HostAsync<HostServiceQueue>(
      value: async,
      onRetry: () => ref.invalidate(serviceQueueProvider),
      skeleton: const SkeletonList(),
      data: (queue) => RefreshIndicator(
        onRefresh: () async => ref.invalidate(serviceQueueProvider),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          children: [
            _StatsHeader(stats: queue.stats),
            const SizedBox(height: 16),
            if (queue.items.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 60),
                child: Center(
                  child: Text('No service requests.', style: TextStyle(color: AppColors.mutedInk)),
                ),
              )
            else
              for (final r in queue.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _QueueTile(request: r),
                ),
          ],
        ),
      ),
    );
  }
}

class _StatsHeader extends StatelessWidget {
  const _StatsHeader({required this.stats});
  final HostServiceStats stats;

  @override
  Widget build(BuildContext context) {
    final avg = stats.avgResolutionHours;
    return Row(
      children: [
        Expanded(child: StatTile(label: 'Open', value: '${stats.openCount}')),
        const SizedBox(width: 10),
        Expanded(
          child: StatTile(
            label: 'Escalated',
            value: '${stats.escalatedCount}',
            accent: stats.escalatedCount > 0 ? AppColors.accent : AppColors.mutedInk,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: StatTile(
            label: 'Avg resolve',
            value: avg == null ? '—' : '${avg.toStringAsFixed(1)}h',
          ),
        ),
      ],
    );
  }
}

class _QueueTile extends StatelessWidget {
  const _QueueTile({required this.request});
  final HostServiceRequest request;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return HostCard(
      onTap: () => context.push('/host/service/${request.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(serviceCategoryLabel(request.category), style: text.titleMedium)),
              ServiceStatusPill(status: request.status),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${request.ticketNumber} · ${request.tenantName}'
            '${request.roomName != null ? ' · ${request.roomName}' : ''}',
            style: AppTypography.priceStyle(fontSize: 12, color: AppColors.mutedInk),
          ),
          const SizedBox(height: 8),
          Text(request.description, maxLines: 2, overflow: TextOverflow.ellipsis, style: text.bodyMedium),
          if (request.isUrgent || request.escalated) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                if (request.escalated) const HostPill(label: 'Escalated', color: AppColors.accent),
                if (request.escalated && request.isUrgent) const SizedBox(width: 6),
                if (request.isUrgent) const HostPill(label: 'Urgent', color: AppColors.sponsored),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Status pill shared by the queue and the detail screen.
class ServiceStatusPill extends StatelessWidget {
  const ServiceStatusPill({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'RESOLVED' => AppColors.verified,
      'ACKNOWLEDGED' => AppColors.agentVisited,
      _ => AppColors.sponsored,
    };
    return HostPill(label: serviceStatusLabel(status), color: color);
  }
}
