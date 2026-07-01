import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/listing_providers.dart';
import '../data/host_listing_repository.dart';
import '../domain/host_listing.dart';

/// Per-listing management hub. Shows the unmasked listing (the host owns it),
/// status, and routes to every per-listing surface (edit, inventory, roster, menu,
/// walk-in, broadcast). Publish reuses the §9.2 go-live gate server-side; pause
/// hides the listing from discovery without deleting it.
class HostListingDetailScreen extends ConsumerWidget {
  const HostListingDetailScreen({super.key, required this.listingId});
  final String listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(hostListingProvider(listingId));
    return Scaffold(
      appBar: AppBar(title: const Text('Listing')),
      body: HostAsync<HostListing>(
        value: async,
        onRetry: () => ref.invalidate(hostListingProvider(listingId)),
        skeleton: const SkeletonList(count: 3, height: 120),
        data: (listing) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(hostListingProvider(listingId)),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
            children: [
              Row(
                children: [
                  Expanded(child: Text(listing.alias, style: Theme.of(context).textTheme.headlineSmall)),
                  HostPill(
                    label: listing.paused ? 'Paused' : listingStatusLabel(listing.status),
                    color: listingStatusColor(listing.status, paused: listing.paused),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(listing.actualName, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 16),
              HostCard(
                child: Column(
                  children: [
                    InfoRow(label: 'Address', value: listing.fullAddress),
                    InfoRow(label: 'Area', value: '${listing.areaLabel} · ${listing.city} ${listing.pincode}'),
                    InfoRow(label: 'For', value: genderLabel(listing.gender)),
                    InfoRow(label: 'Booking', value: listing.instantBook ? 'Instant book' : 'Request to book'),
                    InfoRow(label: 'Token', value: listing.tokenAmount?.format() ?? '—'),
                    InfoRow(
                      label: 'Beds',
                      value: '${listing.availableBeds} free of ${listing.totalBeds}',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              _LifecycleBar(listing: listing, listingId: listingId),
              const SizedBox(height: 24),
              const SectionHeader(eyebrow: 'Manage', title: 'This property'),
              const SizedBox(height: 12),
              _ManageTile(
                icon: Icons.edit_outlined,
                title: 'Edit details',
                subtitle: 'Basics, rooms, amenities, photos',
                onTap: () => context.push('/host/listings/$listingId/edit'),
              ),
              _ManageTile(
                icon: Icons.grid_view_outlined,
                title: 'Inventory',
                subtitle: 'Per-room beds, verify & block',
                trailing: listing.hasStaleInventory
                    ? const HostPill(label: 'Verify', color: AppColors.sponsored)
                    : null,
                onTap: () => context.push('/host/listings/$listingId/inventory'),
              ),
              _ManageTile(
                icon: Icons.groups_outlined,
                title: 'Tenant roster',
                subtitle: 'Current & past tenants',
                onTap: () => context.push('/host/listings/$listingId/roster'),
              ),
              if (listing.mealsOffered)
                _ManageTile(
                  icon: Icons.restaurant_outlined,
                  title: 'Meal menu',
                  subtitle: 'Today, tomorrow & templates',
                  onTap: () => context.push('/host/listings/$listingId/menu'),
                ),
              _ManageTile(
                icon: Icons.person_add_alt_1_outlined,
                title: 'Walk-in entry',
                subtitle: 'Record an off-platform tenant',
                onTap: () => context.push('/host/listings/$listingId/walk-in'),
              ),
              _ManageTile(
                icon: Icons.campaign_outlined,
                title: 'Broadcast',
                subtitle: 'Message current tenants',
                onTap: () => context.push('/host/listings/$listingId/broadcast'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Publish (when DRAFT) + pause/unpause. Publish failures (e.g. the go-live gate)
/// surface as a snackbar; the listing status is server-owned.
class _LifecycleBar extends ConsumerStatefulWidget {
  const _LifecycleBar({required this.listing, required this.listingId});
  final HostListing listing;
  final String listingId;

  @override
  ConsumerState<_LifecycleBar> createState() => _LifecycleBarState();
}

class _LifecycleBarState extends ConsumerState<_LifecycleBar> {
  bool _busy = false;

  Future<void> _run(Future<void> Function(HostListingRepository repo) action, String okMsg) async {
    setState(() => _busy = true);
    try {
      await action(ref.read(hostListingRepositoryProvider));
      ref.invalidate(hostListingProvider(widget.listingId));
      ref.invalidate(hostListingsProvider);
      ref.invalidate(hostDashboardProvider);
      if (mounted) _snack(okMsg);
    } catch (e) {
      if (mounted) _snack(apiExceptionFrom(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  @override
  Widget build(BuildContext context) {
    final listing = widget.listing;
    if (_busy) {
      return const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator()));
    }
    final id = widget.listingId;
    return Row(
      children: [
        if (listing.isDraft)
          Expanded(
            child: PrimaryButton(
              label: 'Publish',
              icon: Icons.publish,
              expand: true,
              onPressed: () => _run((r) => r.publish(id).then((_) {}), 'Submitted for go-live'),
            ),
          ),
        if (listing.isLive || listing.isPending)
          Expanded(
            child: SecondaryButton(
              label: 'Pause',
              icon: Icons.pause_circle_outline,
              expand: true,
              onPressed: () => _run((r) => r.setPaused(id, true).then((_) {}), 'Listing paused'),
            ),
          ),
        if (listing.paused)
          Expanded(
            child: PrimaryButton(
              label: 'Unpause',
              icon: Icons.play_circle_outline,
              expand: true,
              onPressed: () => _run((r) => r.setPaused(id, false).then((_) {}), 'Listing live again'),
            ),
          ),
      ],
    );
  }
}

class _ManageTile extends StatelessWidget {
  const _ManageTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: HostCard(
        onTap: onTap,
        child: Row(
          children: [
            Icon(icon, color: AppColors.ink),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 2),
                  Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
            if (trailing != null) ...[trailing!, const SizedBox(width: 8)],
            const Icon(Icons.chevron_right, color: AppColors.faintInk),
          ],
        ),
      ),
    );
  }
}
