import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../application/listing_providers.dart';
import '../domain/host_listing.dart';

/// Listing management tab: the host's own listings (live / draft / paused), each
/// tapping into the per-listing management hub. A "New listing" action starts the
/// 7-step create flow.
class HostListingsScreen extends ConsumerWidget {
  const HostListingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(hostListingsProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
          child: PrimaryButton(
            label: 'New listing',
            icon: Icons.add_home_work,
            expand: true,
            onPressed: () => context.push('/host/listings/new'),
          ),
        ),
        Expanded(
          child: HostAsync(
            value: async,
            onRetry: () => ref.invalidate(hostListingsProvider),
            skeleton: const SkeletonList(),
            data: (page) {
              if (page.items.isEmpty) {
                return const HostEmpty(
                  icon: Icons.home_work_outlined,
                  message: 'No listings yet. Create your first PG to start taking bookings.',
                );
              }
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(hostListingsProvider),
                child: ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                  itemCount: page.items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => _ListingTile(listing: page.items[i]),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _ListingTile extends StatelessWidget {
  const _ListingTile({required this.listing});
  final HostListing listing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final statusLabel = listing.paused ? 'Paused' : listingStatusLabel(listing.status);
    return HostCard(
      onTap: () => context.push('/host/listings/${listing.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(listing.alias, style: text.titleMedium)),
              HostPill(label: statusLabel, color: listingStatusColor(listing.status, paused: listing.paused)),
            ],
          ),
          const SizedBox(height: 4),
          Text('${listing.areaLabel} · ${listing.city}', style: text.bodySmall),
          const SizedBox(height: 12),
          Row(
            children: [
              _Mini(icon: Icons.bed, label: '${listing.availableBeds}/${listing.totalBeds} free'),
              const SizedBox(width: 16),
              if (listing.priceFrom != null)
                _Mini(icon: Icons.payments_outlined, label: 'from ${listing.priceFrom!.format()}'),
              const Spacer(),
              if (listing.hasStaleInventory)
                const Icon(Icons.fact_check_outlined, size: 18, color: AppColors.sponsored),
            ],
          ),
        ],
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  const _Mini({required this.icon, required this.label});
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
