import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../booking/presentation/booking_sheet.dart';
import '../../wishlist/presentation/wishlist_heart.dart';
import '../application/discovery_providers.dart';
import '../domain/listing.dart';
import 'widgets/amenities.dart';
import 'widgets/cover_image.dart';

/// PG detail — the conversion screen. Renders ONLY masked fields: a photo
/// gallery, room-wise pricing table, amenities and a COARSE area map. It never
/// shows actualName/fullAddress/exact geo (the model can't carry them), so
/// masking holds pre-booking. Sticky Book Now + a wishlist heart.
class ListingDetailScreen extends ConsumerWidget {
  const ListingDetailScreen({super.key, required this.listingId});

  final String listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(listingDetailProvider(listingId));

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorView(message: apiExceptionFrom(e).message, onRetry: () => ref.invalidate(listingDetailProvider(listingId))),
        data: (listing) => _Detail(listing: listing),
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.listing});
  final PublicListing listing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      backgroundColor: AppColors.paper,
      bottomNavigationBar: _BookingBar(listing: listing),
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            pinned: true,
            expandedHeight: 280,
            backgroundColor: AppColors.card,
            actions: [WishlistHeart(listing: listing), const SizedBox(width: 4)],
            flexibleSpace: FlexibleSpaceBar(background: _Gallery(photos: listing.photos)),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(20),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                Text(listing.alias, style: text.headlineSmall),
                const SizedBox(height: 6),
                Row(children: [
                  const Icon(Icons.place_outlined, size: 16, color: AppColors.mutedInk),
                  const SizedBox(width: 4),
                  Expanded(child: Text('${listing.areaLabel}, ${listing.city} · ${genderLabel(listing.gender)}', style: text.bodyMedium)),
                ]),
                const SizedBox(height: 20),
                if (listing.rooms.isNotEmpty) ...[
                  Text('Rooms & pricing', style: text.titleMedium),
                  const SizedBox(height: 10),
                  _RoomTable(rooms: listing.rooms),
                  const SizedBox(height: 24),
                ],
                if (listing.amenities.isNotEmpty) ...[
                  Text('Amenities', style: text.titleMedium),
                  const SizedBox(height: 10),
                  _Amenities(amenities: listing.amenities),
                  const SizedBox(height: 24),
                ],
                Text('Location', style: text.titleMedium),
                const SizedBox(height: 10),
                _MaskedMap(listing: listing),
              ]),
            ),
          ),
        ],
      ),
    );
  }
}

class _Gallery extends StatelessWidget {
  const _Gallery({required this.photos});
  final List<ListingPhoto> photos;

  @override
  Widget build(BuildContext context) {
    if (photos.isEmpty) return const CoverImage();
    return PageView(
      children: [for (final p in photos) CoverImage(url: p.url)],
    );
  }
}

class _RoomTable extends StatelessWidget {
  const _RoomTable({required this.rooms});
  final List<ListingRoom> rooms;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: const BoxDecoration(color: AppColors.card, borderRadius: AppRadii.cardBorder, boxShadow: AppShadows.card),
      child: Column(
        children: [
          for (var i = 0; i < rooms.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: AppColors.hairline),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${rooms[i].name} · ${sharingLabel(rooms[i].sharingType)}', style: text.titleSmall),
                        const SizedBox(height: 2),
                        Text(
                          rooms[i].hasAvailability ? '${rooms[i].availableBeds} of ${rooms[i].totalBeds} beds available' : 'Full',
                          style: text.bodySmall?.copyWith(color: rooms[i].hasAvailability ? AppColors.verified : AppColors.accent),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      PriceText(rooms[i].monthlyRent, fontSize: 16, color: AppColors.accent),
                      const SizedBox(height: 2),
                      Text('+ ${rooms[i].deposit.format()} deposit', style: text.bodySmall),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Amenities extends StatelessWidget {
  const _Amenities({required this.amenities});
  final List<String> amenities;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        for (final a in amenities)
          Chip(
            avatar: Icon(amenityIcon(a), size: 16, color: AppColors.mutedInk),
            label: Text(a),
            backgroundColor: AppColors.card,
          ),
      ],
    );
  }
}

/// Coarse, masked location — area only, no exact pin (the exact address/geo is
/// revealed by the server only after a CONFIRMED booking).
class _MaskedMap extends StatelessWidget {
  const _MaskedMap({required this.listing});
  final PublicListing listing;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: AppRadii.cardBorder,
        gradient: const LinearGradient(colors: [AppColors.agentVisitedWash, AppColors.paperAlt]),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Row(
          children: [
            const Icon(Icons.map_outlined, color: AppColors.agentVisited),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${listing.areaLabel}, ${listing.city}', style: text.titleSmall),
                  const SizedBox(height: 2),
                  Text('Approximate area — exact address shown after your booking is confirmed.', style: text.bodySmall),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BookingBar extends StatelessWidget {
  const _BookingBar({required this.listing});
  final PublicListing listing;

  @override
  Widget build(BuildContext context) {
    final available = listing.hasAvailability;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Row(
          children: [
            if (listing.startingRent != null) ...[
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('from', style: Theme.of(context).textTheme.bodySmall),
                  PriceText(listing.startingRent!, fontSize: 18),
                ],
              ),
              const SizedBox(width: 16),
            ],
            Expanded(
              child: PrimaryButton(
                label: available ? 'Book Now' : 'Fully booked',
                expand: true,
                onPressed: available ? () => _startBooking(context) : null,
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _startBooking(BuildContext context) {
    // The full booking sheet (room / move-in date / meal plan / summary +
    // cancellation policy, KYC-gated) lives in the booking feature; it creates
    // the hold by ROOM and routes to payment or the await-approval screen.
    showBookingSheet(context, listing);
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppColors.accent, size: 48),
            const SizedBox(height: 16),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 20),
            SecondaryButton(label: 'Retry', onPressed: onRetry),
          ],
        ),
      ),
    );
  }
}
