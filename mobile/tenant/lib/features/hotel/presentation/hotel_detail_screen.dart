import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../discovery/domain/listing.dart';
import '../../discovery/presentation/widgets/cover_image.dart';
import '../../kyc/application/kyc_controller.dart';
import '../../kyc/domain/kyc.dart';
import '../data/hotel_repository.dart';
import '../domain/hotel.dart';

/// What the search result hands the detail screen (via go_router `extra`): the
/// masked listing + its categories, plus the stay window the search resolved. The
/// backend has no per-listing hotel endpoint — availability is only ever known for
/// a searched range — so the detail screen books from exactly what search returned.
class HotelDetailArgs {
  final HotelSearchResult result;
  final DateTime checkIn;
  final DateTime checkOut;
  final int guests;
  final int nights;

  const HotelDetailArgs({
    required this.result,
    required this.checkIn,
    required this.checkOut,
    required this.guests,
    required this.nights,
  });
}

/// Hotel detail + booking. Renders ONLY masked fields (alias + area — never the
/// real name/address; the model can't carry them pre-booking), the server-priced
/// room categories for the chosen dates, and a KYC-gated hold. The price shown is
/// the server's `total`/`perNight` read straight off the DTO — never nights ×
/// price in the client (see /CLAUDE.md money rule #1).
class HotelDetailScreen extends ConsumerStatefulWidget {
  const HotelDetailScreen({super.key, required this.listingId, this.args});

  final String listingId;
  final HotelDetailArgs? args;

  @override
  ConsumerState<HotelDetailScreen> createState() => _HotelDetailScreenState();
}

class _HotelDetailScreenState extends ConsumerState<HotelDetailScreen> {
  String? _categoryId;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final categories = widget.args?.result.categories ?? const [];
    _categoryId = categories
        .where((c) => c.isBookable)
        .map((c) => c.categoryId)
        .cast<String?>()
        .firstWhere((_) => true, orElse: () => null);
  }

  HotelCategory? get _selected {
    final args = widget.args;
    if (args == null || _categoryId == null) return null;
    for (final c in args.result.categories) {
      if (c.categoryId == _categoryId) return c;
    }
    return null;
  }

  Future<void> _book() async {
    final args = widget.args;
    final selected = _selected;
    if (args == null || selected == null) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final reservation = await ref.read(hotelRepositoryProvider).createHold(
            categoryId: selected.categoryId,
            checkIn: args.checkIn,
            checkOut: args.checkOut,
            guests: args.guests,
          );
      if (!mounted) return;
      context.push('/tenant/hotels/reservation/${reservation.id}');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = apiExceptionFrom(e).message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final args = widget.args;
    if (args == null) return const _MissingArgs();

    final listing = args.result.listing;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      backgroundColor: AppColors.paper,
      bottomNavigationBar: _BookBar(
        selected: _selected,
        submitting: _submitting,
        onBook: _book,
      ),
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            pinned: true,
            expandedHeight: 260,
            backgroundColor: AppColors.card,
            flexibleSpace: FlexibleSpaceBar(background: _Gallery(photos: listing.photos)),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(20),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                Row(
                  children: [
                    const Icon(Icons.hotel, size: 18, color: AppColors.agentVisited),
                    const SizedBox(width: 6),
                    Expanded(child: Text(listing.alias, style: text.headlineSmall)),
                  ],
                ),
                const SizedBox(height: 6),
                Row(children: [
                  const Icon(Icons.place_outlined, size: 16, color: AppColors.mutedInk),
                  const SizedBox(width: 4),
                  Expanded(child: Text('${listing.areaLabel}, ${listing.city}', style: text.bodyMedium)),
                ]),
                const SizedBox(height: 6),
                Text(
                  '${_fmt(args.checkIn)} → ${_fmt(args.checkOut)} · ${args.nights} night${args.nights == 1 ? '' : 's'} · '
                  '${args.guests} guest${args.guests == 1 ? '' : 's'}',
                  style: text.bodySmall?.copyWith(color: AppColors.mutedInk),
                ),
                const SizedBox(height: 24),
                Text('Choose a room', style: text.titleMedium),
                const SizedBox(height: 10),
                _CategoryList(
                  categories: args.result.categories,
                  selectedId: _categoryId,
                  onSelect: (id) => setState(() => _categoryId = id),
                ),
                if (_selected != null) ...[
                  const SizedBox(height: 16),
                  _PriceSummary(category: _selected!, nights: args.nights, guests: args.guests),
                ],
                if (listing.amenities.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text('Amenities', style: text.titleMedium),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      for (final a in listing.amenities)
                        Chip(label: Text(a), backgroundColor: AppColors.card),
                    ],
                  ),
                ],
                const SizedBox(height: 24),
                Text('Location', style: text.titleMedium),
                const SizedBox(height: 10),
                _MaskedArea(listing: listing),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(_error!, style: const TextStyle(color: AppColors.accent)),
                ],
              ]),
            ),
          ),
        ],
      ),
    );
  }

  static String _fmt(DateTime d) => '${d.day}/${d.month}/${d.year}';
}

class _Gallery extends StatelessWidget {
  const _Gallery({required this.photos});
  final List<ListingPhoto> photos;

  @override
  Widget build(BuildContext context) {
    if (photos.isEmpty) return const CoverImage();
    return PageView(children: [for (final p in photos) CoverImage(url: p.url)]);
  }
}

class _CategoryList extends StatelessWidget {
  const _CategoryList({required this.categories, required this.selectedId, required this.onSelect});

  final List<HotelCategory> categories;
  final String? selectedId;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(color: AppColors.card, borderRadius: AppRadii.cardBorder, boxShadow: AppShadows.card),
      child: Column(
        children: [
          for (var i = 0; i < categories.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: AppColors.hairline),
            _CategoryTile(
              category: categories[i],
              selected: categories[i].categoryId == selectedId,
              onTap: categories[i].isBookable ? () => onSelect(categories[i].categoryId) : null,
            ),
          ],
        ],
      ),
    );
  }
}

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({required this.category, required this.selected, this.onTap});

  final HotelCategory category;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final bookable = category.isBookable;
    return ListTile(
      enabled: bookable,
      onTap: onTap,
      leading: Icon(
        selected ? Icons.radio_button_checked : Icons.radio_button_off,
        color: selected ? AppColors.accent : AppColors.faintInk,
      ),
      title: Text(category.tier, style: text.titleSmall),
      subtitle: Text(
        bookable
            ? '${category.availableRooms} room${category.availableRooms == 1 ? '' : 's'} free for your dates'
            : 'Sold out for these dates',
        style: text.bodySmall?.copyWith(color: bookable ? AppColors.verified : AppColors.faintInk),
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          PriceText(category.perNight, fontSize: 15, color: AppColors.accent),
          Text('/night', style: text.bodySmall),
        ],
      ),
    );
  }
}

/// The server-owned stay price. The amount shown is the category's `total`
/// (perNightPaise × nights, computed on the server) read straight from the DTO —
/// the "× nights" here is only a label; no money is multiplied in the client.
class _PriceSummary extends StatelessWidget {
  const _PriceSummary({required this.category, required this.nights, required this.guests});

  final HotelCategory category;
  final int nights;
  final int guests;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(color: AppColors.paperAlt, borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('$nights night${nights == 1 ? '' : 's'} × ${category.perNight.format()}', style: text.bodyMedium),
                PriceText(category.total, fontSize: 15, color: AppColors.ink),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Pay now (full stay)', style: text.bodyMedium),
                PriceText(category.total, fontSize: 16, color: AppColors.accent),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'This is the price our server will charge for $guests guest${guests == 1 ? '' : 's'} — '
              "it is final and not calculated on your device. You're confirmed only once the payment settles.",
              style: text.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _MaskedArea extends StatelessWidget {
  const _MaskedArea({required this.listing});
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
                  Text('Approximate area — the exact address is shown after your booking is confirmed.',
                      style: text.bodySmall),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Sticky book bar with the KYC gate. Payment is blocked server-side until KYC is
/// VERIFIED (`requireKyc`); we surface that up-front rather than let the hold 403.
class _BookBar extends ConsumerWidget {
  const _BookBar({required this.selected, required this.submitting, required this.onBook});

  final HotelCategory? selected;
  final bool submitting;
  final VoidCallback onBook;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kyc = ref.watch(kycStatusProvider);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: _cta(context, ref, kyc),
      ),
    );
  }

  Widget _cta(BuildContext context, WidgetRef ref, AsyncValue<KycView> kyc) {
    if (selected == null) {
      return const PrimaryButton(label: 'No rooms available', expand: true);
    }
    return kyc.when(
      loading: () => const PrimaryButton(label: 'Checking KYC…', expand: true),
      error: (_, __) => PrimaryButton(
        label: 'Retry',
        expand: true,
        onPressed: () => ref.invalidate(kycStatusProvider),
      ),
      data: (view) {
        if (!view.isVerified) {
          return PrimaryButton(
            label: 'Complete KYC to book',
            icon: Icons.verified_user_outlined,
            expand: true,
            onPressed: () => context.push('/tenant/kyc'),
          );
        }
        return PrimaryButton(
          label: submitting ? 'Holding your room…' : 'Book — hold & pay',
          expand: true,
          onPressed: submitting ? null : onBook,
        );
      },
    );
  }
}

class _MissingArgs extends StatelessWidget {
  const _MissingArgs();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Hotel')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.search_off, size: 48, color: AppColors.faintInk),
              const SizedBox(height: 16),
              const Text(
                'Availability depends on your dates. Start from a hotel search to book this stay.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              SecondaryButton(label: 'Back to search', onPressed: () => context.go('/tenant')),
            ],
          ),
        ),
      ),
    );
  }
}
