import 'package:flutter/material.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../../wishlist/presentation/wishlist_heart.dart';
import '../../domain/listing.dart';
import 'amenities.dart';
import 'cover_image.dart';

/// A discovery result card built on the core [ListingCard] shell. Renders ONLY
/// masked fields the API sent: cover photo, alias, area (+ distance when the
/// nearby endpoint provided it), starting rent (via the Paise formatter), and a
/// few amenity icons. NOTE: the public contract carries no verified/agent-visited
/// signal, so trust tags are intentionally NOT rendered here (see feature notes).
class ListingResultCard extends StatelessWidget {
  const ListingResultCard({super.key, required this.listing, required this.onTap});

  final PublicListing listing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final distance = distanceLabel(listing.distanceMeters);
    final where = distance == null
        ? '${listing.areaLabel}, ${listing.city}'
        : '${listing.areaLabel} · $distance';

    return ListingCard(
      onTap: onTap,
      media: Stack(
        fit: StackFit.expand,
        children: [
          CoverImage(url: listing.coverPhoto?.url),
          Positioned(top: 6, right: 6, child: WishlistHeart(listing: listing, onCard: true)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(listing.alias, style: text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis)),
              const SizedBox(width: 8),
              _GenderChip(gender: listing.gender),
            ],
          ),
          const SizedBox(height: 4),
          Text(where, style: text.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 10),
          if (listing.startingRent != null)
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                PriceText(listing.startingRent!, fontSize: 18, color: AppColors.accent),
                const SizedBox(width: 4),
                Text('/mo onwards', style: text.bodySmall),
              ],
            )
          else
            Text('Price on request', style: text.titleSmall),
          if (listing.amenities.isNotEmpty) ...[
            const SizedBox(height: 10),
            _AmenityIcons(amenities: listing.amenities),
          ],
        ],
      ),
    );
  }
}

class _GenderChip extends StatelessWidget {
  const _GenderChip({required this.gender});
  final String gender;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(color: AppColors.paperAlt, borderRadius: AppRadii.pillBorder),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Text(
          genderLabel(gender),
          style: AppTypography.textTheme.labelSmall?.copyWith(color: AppColors.mutedInk),
        ),
      ),
    );
  }
}

class _AmenityIcons extends StatelessWidget {
  const _AmenityIcons({required this.amenities});
  final List<String> amenities;

  @override
  Widget build(BuildContext context) {
    const maxIcons = 4;
    final shown = amenities.take(maxIcons).toList();
    final extra = amenities.length - shown.length;
    return Row(
      children: [
        for (final a in shown) ...[
          Icon(amenityIcon(a), size: 16, color: AppColors.mutedInk),
          const SizedBox(width: 10),
        ],
        if (extra > 0)
          Text('+$extra', style: AppTypography.textTheme.labelSmall?.copyWith(color: AppColors.faintInk)),
      ],
    );
  }
}
