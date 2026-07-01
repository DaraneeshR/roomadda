import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../listings/application/listing_providers.dart';
import '../../walkin/application/walk_in_providers.dart';
import '../../walkin/data/walk_in_repository.dart';
import '../application/roster_providers.dart';
import '../domain/roster_tenant.dart';

/// Tenant roster — current (default) or past tenants. Shows ONLY name, room,
/// move-in and rent status: NO KYC, NO phone, NO cross-tenant data (/CLAUDE.md
/// domain rule #4). Walk-in tenants can be checked out (frees their bed); platform
/// bookings have no host-side checkout in MVP.
class RosterScreen extends ConsumerStatefulWidget {
  const RosterScreen({super.key, required this.listingId});
  final String listingId;

  @override
  ConsumerState<RosterScreen> createState() => _RosterScreenState();
}

class _RosterScreenState extends ConsumerState<RosterScreen> {
  String _scope = 'current';

  @override
  Widget build(BuildContext context) {
    final query = RosterQuery(widget.listingId, _scope);
    final async = ref.watch(rosterProvider(query));
    return Scaffold(
      appBar: AppBar(title: const Text('Tenant roster')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'current', label: Text('Current')),
                ButtonSegment(value: 'past', label: Text('Past')),
              ],
              selected: {_scope},
              onSelectionChanged: (s) => setState(() => _scope = s.first),
            ),
          ),
          Expanded(
            child: HostAsync<List<RosterTenant>>(
              value: async,
              onRetry: () => ref.invalidate(rosterProvider(query)),
              skeleton: const SkeletonList(),
              data: (items) {
                if (items.isEmpty) {
                  return HostEmpty(
                    icon: Icons.groups_outlined,
                    message: _scope == 'current' ? 'No current tenants yet.' : 'No past tenants yet.',
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(rosterProvider(query)),
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => _RosterTile(
                      listingId: widget.listingId,
                      tenant: items[i],
                      isPast: _scope == 'past',
                    ),
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

class _RosterTile extends ConsumerWidget {
  const _RosterTile({required this.listingId, required this.tenant, required this.isPast});
  final String listingId;
  final RosterTenant tenant;
  final bool isPast;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return HostCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(tenant.name, style: text.titleMedium)),
              if (tenant.isWalkIn)
                const HostPill(label: 'Walk-in', color: AppColors.agentVisited)
              else
                HostPill(label: rentStatusLabel(tenant.rentStatus), color: _rentColor(tenant.rentStatus)),
            ],
          ),
          const SizedBox(height: 6),
          InfoRow(label: 'Room', value: tenant.roomName),
          if (tenant.moveInDate != null)
            InfoRow(label: 'Move-in', value: DateFormat.yMMMd().format(tenant.moveInDate!)),
          InfoRow(label: 'Rent', value: tenant.monthlyRent.format()),
          if (isPast && tenant.moveOutDate != null)
            InfoRow(
              label: 'Move-out',
              value: '${DateFormat.yMMMd().format(tenant.moveOutDate!)}'
                  '${tenant.durationDays != null ? ' · ${tenant.durationDays} days' : ''}',
            ),
          if (!isPast && tenant.isWalkIn) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: SecondaryButton(
                label: 'Mark checked out',
                icon: Icons.logout,
                onPressed: () => _checkout(context, ref),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _checkout(BuildContext context, WidgetRef ref) async {
    try {
      await ref.read(walkInRepositoryProvider).checkout(tenant.id);
      ref.invalidate(rosterProvider(RosterQuery(listingId, 'current')));
      ref.invalidate(rosterProvider(RosterQuery(listingId, 'past')));
      ref.invalidate(walkInsProvider(listingId));
      ref.invalidate(hostListingProvider(listingId));
      ref.invalidate(hostDashboardProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Checked out')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
      }
    }
  }

  Color _rentColor(String status) => switch (status) {
        'PAID' => AppColors.verified,
        'DUE' => AppColors.sponsored,
        'OVERDUE' => AppColors.accent,
        _ => AppColors.faintInk,
      };
}
