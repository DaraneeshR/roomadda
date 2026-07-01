import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../listings/application/listing_providers.dart';
import '../../listings/data/host_listing_repository.dart';
import '../../listings/domain/host_listing.dart';

/// Inventory: per-room Total / Occupied / Available, the "verify inventory" action
/// (clears the not-verified-3-days flag) and a manual block/unblock adjust. Bed
/// status is server-owned; the app only requests verify/adjust and re-reads.
class InventoryScreen extends ConsumerWidget {
  const InventoryScreen({super.key, required this.listingId});
  final String listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(hostListingProvider(listingId));
    return Scaffold(
      appBar: AppBar(title: const Text('Inventory')),
      body: HostAsync<HostListing>(
        value: async,
        onRetry: () => ref.invalidate(hostListingProvider(listingId)),
        skeleton: const SkeletonList(count: 3, height: 150),
        data: (listing) {
          if (listing.rooms.isEmpty) {
            return const HostEmpty(icon: Icons.grid_off, message: 'No rooms yet. Add rooms from Edit details.');
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(hostListingProvider(listingId)),
            child: ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              itemCount: listing.rooms.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (_, i) => _RoomCard(listingId: listingId, room: listing.rooms[i]),
            ),
          );
        },
      ),
    );
  }
}

class _RoomCard extends ConsumerStatefulWidget {
  const _RoomCard({required this.listingId, required this.room});
  final String listingId;
  final HostRoomInventory room;

  @override
  ConsumerState<_RoomCard> createState() => _RoomCardState();
}

class _RoomCardState extends ConsumerState<_RoomCard> {
  bool _busy = false;

  Future<void> _run(Future<void> Function(HostListingRepository repo) action, String okMsg) async {
    setState(() => _busy = true);
    try {
      await action(ref.read(hostListingRepositoryProvider));
      ref.invalidate(hostListingProvider(widget.listingId));
      ref.invalidate(hostDashboardProvider);
      if (mounted) _snack(okMsg);
    } catch (e) {
      if (mounted) _snack(apiExceptionFrom(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final room = widget.room;
    final text = Theme.of(context).textTheme;
    return HostCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(room.name, style: text.titleMedium)),
              if (room.needsVerification)
                const HostPill(label: 'Verify', color: AppColors.sponsored)
              else
                const HostPill(label: 'Verified', color: AppColors.verified),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _Count(label: 'Total', value: room.totalBeds),
              _Count(label: 'Occupied', value: room.occupiedBeds, color: AppColors.accent),
              _Count(label: 'Available', value: room.availableBeds, color: AppColors.verified),
            ],
          ),
          if (room.walkInBeds > 0 || room.heldBeds > 0) ...[
            const SizedBox(height: 8),
            Text(
              [
                if (room.bookedBeds > 0) '${room.bookedBeds} booked',
                if (room.walkInBeds > 0) '${room.walkInBeds} walk-in',
                if (room.heldBeds > 0) '${room.heldBeds} held',
              ].join(' · '),
              style: text.bodySmall,
            ),
          ],
          const SizedBox(height: 12),
          if (_busy)
            const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator()))
          else
            Row(
              children: [
                Expanded(
                  child: SecondaryButton(
                    label: 'Verify',
                    icon: Icons.fact_check_outlined,
                    expand: true,
                    onPressed: () => _run(
                      (r) => r.verifyInventory(widget.listingId, room.roomId).then((_) {}),
                      'Inventory verified',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.outlined(
                  tooltip: 'Block a bed',
                  icon: const Icon(Icons.remove),
                  onPressed: room.availableBeds > 0
                      ? () => _run(
                            (r) => r.adjustInventory(widget.listingId, room.roomId, 'BLOCK', 1).then((_) {}),
                            'Bed blocked',
                          )
                      : null,
                ),
                const SizedBox(width: 8),
                IconButton.outlined(
                  tooltip: 'Unblock a bed',
                  icon: const Icon(Icons.add),
                  onPressed: room.walkInBeds > 0
                      ? () => _run(
                            (r) => r.adjustInventory(widget.listingId, room.roomId, 'UNBLOCK', 1).then((_) {}),
                            'Bed unblocked',
                          )
                      : null,
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _Count extends StatelessWidget {
  const _Count({required this.label, required this.value, this.color});
  final String label;
  final int value;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text('$value', style: AppTypography.priceStyle(fontSize: 22, color: color ?? AppColors.ink)),
          const SizedBox(height: 2),
          Text(label.toUpperCase(), style: AppTypography.eyebrow),
        ],
      ),
    );
  }
}
