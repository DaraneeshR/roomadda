import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../discovery/presentation/widgets/listing_result_card.dart';
import '../application/wishlist_controller.dart';

/// The Saved tab — the tenant's wishlisted listings (masked), with the heart on
/// each card removing it. Shared with the web tenant account (same endpoints).
class WishlistScreen extends ConsumerWidget {
  const WishlistScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(wishlistControllerProvider);
    final controller = ref.read(wishlistControllerProvider.notifier);

    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('Saved')),
      body: RefreshIndicator(
        onRefresh: controller.load,
        child: _body(context, state),
      ),
    );
  }

  Widget _body(BuildContext context, WishlistState state) {
    if (state.loading && state.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 120),
          Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  const Icon(Icons.favorite_border, size: 48, color: AppColors.faintInk),
                  const SizedBox(height: 16),
                  Text(
                    state.error ?? 'No saved PGs yet. Tap the heart on a listing to save it.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      itemCount: state.items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 16),
      itemBuilder: (context, index) {
        final listing = state.items[index];
        return ListingResultCard(
          listing: listing,
          onTap: () => context.push('/tenant/listing/${listing.id}'),
        );
      },
    );
  }
}
