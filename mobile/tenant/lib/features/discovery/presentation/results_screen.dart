import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/listings_controller.dart';
import 'filters_sheet.dart';
import 'widgets/listing_result_card.dart';
import 'widgets/listing_skeleton.dart';

/// Results list — masked cards, skeletons during fetch, filter + map entry, and
/// infinite scroll (15/page).
class ResultsScreen extends ConsumerWidget {
  const ResultsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(listingsControllerProvider);
    final controller = ref.read(listingsControllerProvider.notifier);

    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        title: Text(state.placeLabel ?? 'Search results'),
        actions: [
          if (state.geo != null)
            IconButton(
              tooltip: 'Map view',
              icon: const Icon(Icons.map_outlined),
              onPressed: () => context.push('/tenant/map'),
            ),
          IconButton(
            tooltip: 'Filters',
            icon: Badge(
              isLabelVisible: state.filters.activeCount > 0,
              label: Text('${state.filters.activeCount}'),
              child: const Icon(Icons.tune),
            ),
            onPressed: () => showFiltersSheet(context, ref),
          ),
        ],
      ),
      body: _body(context, ref, state, controller),
    );
  }

  Widget _body(BuildContext context, WidgetRef ref, ListingsState state, ListingsController controller) {
    if (state.loading) return const ListingSkeletonList();

    if (state.error != null && state.isEmpty) {
      return _Message(
        icon: Icons.wifi_off,
        message: state.error!,
        actionLabel: 'Retry',
        onAction: () => controller.search(),
      );
    }
    if (state.isEmpty) {
      return const _Message(
        icon: Icons.search_off,
        message: 'No PGs match your search. Try a wider area or fewer filters.',
      );
    }

    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (n.metrics.pixels >= n.metrics.maxScrollExtent - 400 && state.hasMore && !state.loadingMore) {
          controller.loadMore();
        }
        return false;
      },
      child: RefreshIndicator(
        onRefresh: () => controller.search(),
        child: ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: state.items.length + 1,
          separatorBuilder: (_, __) => const SizedBox(height: 16),
          itemBuilder: (context, index) {
            if (index == state.items.length) {
              return _Footer(loadingMore: state.loadingMore, hasMore: state.hasMore);
            }
            final listing = state.items[index];
            return ListingResultCard(
              listing: listing,
              onTap: () => context.push('/tenant/listing/${listing.id}'),
            );
          },
        ),
      ),
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer({required this.loadingMore, required this.hasMore});
  final bool loadingMore;
  final bool hasMore;

  @override
  Widget build(BuildContext context) {
    if (loadingMore) {
      return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
    }
    if (!hasMore) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Center(child: Text("That's all for now", style: Theme.of(context).textTheme.bodySmall)),
      );
    }
    return const SizedBox(height: 24);
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.message, this.actionLabel, this.onAction});

  final IconData icon;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: AppColors.faintInk),
            const SizedBox(height: 16),
            Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 20),
              SecondaryButton(label: actionLabel!, onPressed: onAction),
            ],
          ],
        ),
      ),
    );
  }
}
