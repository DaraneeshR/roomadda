import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_tab.dart';
import '../../common/host_widgets.dart';
import '../application/dashboard_providers.dart';
import '../domain/host_dashboard.dart';

/// Host home: a portfolio rollup — revenue (expected / collected / overdue),
/// occupancy, the pending-requests count, and quick actions. Money is paise,
/// formatted only via the shared [Paise] helper.
class HostDashboardScreen extends ConsumerWidget {
  const HostDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(hostDashboardProvider);
    return HostAsync<HostDashboard>(
      value: async,
      onRetry: () => ref.invalidate(hostDashboardProvider),
      skeleton: const SkeletonList(count: 5, height: 88),
      data: (dash) => RefreshIndicator(
        onRefresh: () async => ref.invalidate(hostDashboardProvider),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          children: [
            const SectionHeader(eyebrow: 'This month', title: 'Revenue'),
            const SizedBox(height: 12),
            _RevenueGrid(dash: dash),
            const SizedBox(height: 24),
            const SectionHeader(eyebrow: 'Occupancy', title: 'Beds'),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: StatTile(
                    label: 'Occupied',
                    value: '${dash.occupiedBeds}',
                    sublabel: 'of ${dash.totalBeds} beds',
                    icon: Icons.bed,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: StatTile(
                    label: 'Vacant',
                    value: '${dash.vacantBeds}',
                    sublabel: '${dash.liveListings} live PG${dash.liveListings == 1 ? '' : 's'}',
                    accent: AppColors.verified,
                    icon: Icons.event_available,
                  ),
                ),
              ],
            ),
            if (dash.hasStaleInventory) ...[
              const SizedBox(height: 12),
              const _Nudge(
                icon: Icons.fact_check_outlined,
                text: 'Some rooms haven’t been verified in 3 days. Open a listing to verify inventory.',
              ),
            ],
            const SizedBox(height: 24),
            const SectionHeader(eyebrow: 'Needs you', title: 'Action items'),
            const SizedBox(height: 12),
            _ActionRow(
              icon: Icons.mark_email_unread_outlined,
              label: 'Booking requests',
              count: dash.pendingRequests,
              onTap: () => ref.read(hostTabIndexProvider.notifier).state = HostTab.requests,
            ),
            const SizedBox(height: 10),
            _ActionRow(
              icon: Icons.build_outlined,
              label: 'Open service requests',
              count: dash.openServiceRequests,
              badge: dash.escalatedServiceRequests > 0 ? '${dash.escalatedServiceRequests} escalated' : null,
              onTap: () => ref.read(hostTabIndexProvider.notifier).state = HostTab.service,
            ),
            const SizedBox(height: 24),
            const SectionHeader(eyebrow: 'Quick actions', title: 'Manage'),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _QuickAction(icon: Icons.add_home_work, label: 'New listing', onTap: () => context.push('/host/listings/new')),
                if (dash.hasListings)
                  _QuickAction(
                    icon: Icons.person_add_alt,
                    label: 'Walk-in',
                    onTap: () => context.push('/host/listings/${dash.listings.first.id}/walk-in'),
                  ),
                if (dash.hasListings)
                  _QuickAction(
                    icon: Icons.campaign_outlined,
                    label: 'Broadcast',
                    onTap: () => context.push('/host/listings/${dash.listings.first.id}/broadcast'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _RevenueGrid extends StatelessWidget {
  const _RevenueGrid({required this.dash});
  final HostDashboard dash;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(child: StatTile(label: 'Expected', value: dash.expected.format())),
            const SizedBox(width: 12),
            Expanded(
              child: StatTile(
                label: 'Collected',
                value: dash.collected.format(),
                sublabel: '${(dash.collectionRate * 100).round()}% of expected',
                accent: AppColors.verified,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        StatTile(
          label: 'Overdue',
          value: dash.overdue.format(),
          accent: dash.overdue.value > 0 ? AppColors.accent : AppColors.mutedInk,
          icon: Icons.schedule,
        ),
      ],
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({required this.icon, required this.label, required this.count, this.badge, this.onTap});

  final IconData icon;
  final String label;
  final int count;
  final String? badge;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return HostCard(
      onTap: onTap,
      child: Row(
        children: [
          Icon(icon, color: AppColors.ink),
          const SizedBox(width: 12),
          Expanded(child: Text(label, style: Theme.of(context).textTheme.titleSmall)),
          if (badge != null) ...[
            HostPill(label: badge!, color: AppColors.accent),
            const SizedBox(width: 8),
          ],
          Text('$count', style: AppTypography.priceStyle(fontSize: 18, color: count > 0 ? AppColors.accent : AppColors.faintInk)),
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.card,
      borderRadius: AppRadii.pillBorder,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: AppRadii.pillBorder,
            border: Border.all(color: AppColors.hairlineStrong),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 18, color: AppColors.ink),
                const SizedBox(width: 8),
                Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Nudge extends StatelessWidget {
  const _Nudge({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: const BoxDecoration(
        color: AppColors.sponsoredWash,
        borderRadius: AppRadii.cardBorder,
      ),
      child: Row(
        children: [
          Icon(icon, color: AppColors.sponsored, size: 20),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: const TextStyle(color: AppColors.ink, fontSize: 13))),
        ],
      ),
    );
  }
}
