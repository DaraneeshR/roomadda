import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../discovery/domain/listing.dart';
import '../application/wishlist_controller.dart';

/// A save/unsave heart for a listing. Reads the shared wishlist state so it
/// stays in sync across cards, the detail screen and the Saved tab. Optimistic
/// toggle (handled in the controller).
class WishlistHeart extends ConsumerWidget {
  const WishlistHeart({super.key, required this.listing, this.onCard = false});

  final PublicListing listing;

  /// When placed over a card photo, render on a white circular background.
  final bool onCard;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final saved = ref.watch(wishlistControllerProvider.select((s) => s.savedIds.contains(listing.id)));
    final icon = Icon(
      saved ? Icons.favorite : Icons.favorite_border,
      color: saved ? AppColors.accent : (onCard ? AppColors.ink : AppColors.mutedInk),
      size: 22,
    );

    final button = IconButton(
      tooltip: saved ? 'Remove from wishlist' : 'Save to wishlist',
      icon: icon,
      onPressed: () => ref.read(wishlistControllerProvider.notifier).toggle(listing),
    );

    if (!onCard) return button;
    return DecoratedBox(
      decoration: const BoxDecoration(color: AppColors.card, shape: BoxShape.circle),
      child: button,
    );
  }
}
