import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/listings_controller.dart';
import '../data/places_service.dart';
import '../domain/filters.dart';
import '../domain/listing.dart';

/// Current search input, drives Places autocomplete (per-keystroke, ≥3 chars).
final _searchInputProvider = StateProvider.autoDispose<String>((ref) => '');

/// In-session recent searches (most recent first). Local-only for now.
final recentSearchesProvider = StateProvider<List<String>>((ref) => const []);

/// Smart Search / Home — Places autocomplete over the masked discovery API.
/// Selecting a suggestion (or submitting text) runs a browse search and opens
/// the results list; a resolved place also seeds the map view's geo.
class DiscoveryHomeScreen extends ConsumerStatefulWidget {
  const DiscoveryHomeScreen({super.key});

  @override
  ConsumerState<DiscoveryHomeScreen> createState() => _DiscoveryHomeScreenState();
}

class _DiscoveryHomeScreenState extends ConsumerState<DiscoveryHomeScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _runSearch({required String term, String? placeId}) async {
    final query = term.trim();
    if (query.isEmpty) return;
    FocusScope.of(context).unfocus();

    GeoPoint? geo;
    var label = query;
    if (placeId != null) {
      final place = await ref.read(placesServiceProvider).details(placeId);
      if (place != null) {
        geo = GeoPoint(place.lat, place.lng);
        label = place.label.isNotEmpty ? place.label : query;
      }
    }

    // Match against the listing's area label (contains, case-insensitive).
    final filters = ListingFilters(area: query.split(',').first.trim());
    await ref.read(listingsControllerProvider.notifier).search(filters: filters, geo: geo, placeLabel: label);

    final recents = ref.read(recentSearchesProvider);
    ref.read(recentSearchesProvider.notifier).state =
        [query, ...recents.where((r) => r != query)].take(5).toList();

    if (mounted) context.push('/tenant/results');
  }

  @override
  Widget build(BuildContext context) {
    final input = ref.watch(_searchInputProvider);
    final text = Theme.of(context).textTheme;

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const SizedBox(height: 8),
            Text('Find your', style: text.headlineMedium),
            Text('next PG home', style: text.headlineMedium?.copyWith(color: AppColors.accent)),
            const SizedBox(height: 6),
            Text('Verified PGs near your college or work — zero brokerage.', style: text.bodyMedium),
            const SizedBox(height: 20),
            _SearchField(
              controller: _controller,
              onChanged: (v) => ref.read(_searchInputProvider.notifier).state = v,
              onSubmitted: (v) => _runSearch(term: v),
            ),
            const SizedBox(height: 12),
            if (input.trim().length >= 3)
              _Suggestions(input: input.trim(), onPick: (s) {
                _controller.text = s.description;
                _runSearch(term: s.description, placeId: s.placeId);
              })
            else
              _RecentSearches(onSelected: (term) {
                _controller.text = term;
                _runSearch(term: term);
              }),
          ],
        ),
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller, required this.onChanged, required this.onSubmitted});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: 'Area, landmark, college, metro…',
        prefixIcon: const Icon(Icons.search),
        filled: true,
        fillColor: AppColors.card,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
      ),
    );
  }
}

class _Suggestions extends ConsumerWidget {
  const _Suggestions({required this.input, required this.onPick});

  final String input;
  final ValueChanged<PlaceSuggestion> onPick;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(placesAutocompleteProvider(input));
    return async.when(
      loading: () => const Padding(padding: EdgeInsets.all(12), child: LinearProgressIndicator()),
      error: (_, __) => const SizedBox.shrink(),
      data: (suggestions) {
        if (suggestions.isEmpty) {
          // No Places key / no matches → submit the typed text directly.
          return ListTile(
            leading: const Icon(Icons.search),
            title: Text('Search "$input"'),
            onTap: () => onPick(PlaceSuggestion(placeId: '', description: input)),
          );
        }
        return Column(
          children: [
            for (final s in suggestions)
              ListTile(
                leading: const Icon(Icons.place_outlined, color: AppColors.mutedInk),
                title: Text(s.description, maxLines: 1, overflow: TextOverflow.ellipsis),
                onTap: () => onPick(s),
              ),
          ],
        );
      },
    );
  }
}

class _RecentSearches extends ConsumerWidget {
  const _RecentSearches({required this.onSelected});

  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recents = ref.watch(recentSearchesProvider);
    if (recents.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('RECENT', style: AppTypography.eyebrow),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final r in recents)
              ActionChip(label: Text(r), onPressed: () => onSelected(r)),
          ],
        ),
      ],
    );
  }
}
