import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/service_providers.dart';
import '../domain/service_request.dart';

/// The Service tab body: the tenant's maintenance requests with a "Raise a
/// request" action. Lives inside the dashboard Scaffold, so it's a plain body.
class ServiceRequestsScreen extends ConsumerWidget {
  const ServiceRequestsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(serviceRequestsProvider);
    final text = Theme.of(context).textTheme;

    return SafeArea(
      top: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Text('Service requests', style: text.headlineSmall),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: PrimaryButton(
              label: 'Raise a request',
              icon: Icons.add,
              expand: true,
              onPressed: () => context.push('/tenant/service/new'),
            ),
          ),
          Expanded(
            child: async.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => _Message(message: apiExceptionFrom(e).message),
              data: (page) {
                if (page.items.isEmpty) {
                  return const _Message(message: 'No requests yet. Raise one for any maintenance issue in your PG.');
                }
                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(serviceRequestsProvider),
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                    itemCount: page.items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => _RequestTile(request: page.items[i]),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _RequestTile extends StatelessWidget {
  const _RequestTile({required this.request});

  final ServiceRequest request;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Material(
      color: AppColors.card,
      borderRadius: AppRadii.cardBorder,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/tenant/service/${request.id}'),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: AppRadii.cardBorder,
            border: Border.all(color: AppColors.hairline),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(serviceCategoryLabel(request.category), style: text.titleMedium)),
                    ServiceStatusChip(status: request.status),
                  ],
                ),
                const SizedBox(height: 4),
                Text(request.ticketNumber, style: AppTypography.priceStyle(fontSize: 13, color: AppColors.mutedInk)),
                const SizedBox(height: 8),
                Text(request.description, maxLines: 2, overflow: TextOverflow.ellipsis, style: text.bodyMedium),
                if (request.isUrgent || request.escalated) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      if (request.isUrgent) const _Tag(label: 'URGENT', color: AppColors.accent),
                      if (request.isUrgent && request.escalated) const SizedBox(width: 6),
                      if (request.escalated) const _Tag(label: 'ESCALATED', color: AppColors.accent),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Status pill shared by the list and detail screens.
class ServiceStatusChip extends StatelessWidget {
  const ServiceStatusChip({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'RESOLVED' => AppColors.verified,
      'ACKNOWLEDGED' => AppColors.agentVisited,
      _ => AppColors.sponsored,
    };
    return _Tag(label: serviceStatusLabel(status).toUpperCase(), color: color);
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: AppRadii.pillBorder),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 100),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.mutedInk)),
          ),
        ),
      ],
    );
  }
}
