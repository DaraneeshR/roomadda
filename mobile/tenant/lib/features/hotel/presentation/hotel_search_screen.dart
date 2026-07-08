import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../discovery/presentation/widgets/cover_image.dart';
import '../application/hotel_providers.dart';
import '../domain/hotel.dart';
import 'hotel_detail_screen.dart';

/// The Hotels tab. A city + date-range + guests search over the masked B2C hotel
/// availability API; results are HOTEL listings with a server-owned per-night
/// price and REAL free-room count for the selected dates. Tapping a card opens the
/// detail + booking screen carrying the same stay. Discovery is never gated (KYC
/// is just-in-time at the booking step).
class HotelSearchScreen extends ConsumerStatefulWidget {
  const HotelSearchScreen({super.key});

  @override
  ConsumerState<HotelSearchScreen> createState() => _HotelSearchScreenState();
}

class _HotelSearchScreenState extends ConsumerState<HotelSearchScreen> {
  final _city = TextEditingController();
  late DateTimeRange _range;
  int _guests = 1;

  @override
  void initState() {
    super.initState();
    final today = _dateOnly(DateTime.now());
    _range = DateTimeRange(start: today, end: today.add(const Duration(days: 1)));
  }

  @override
  void dispose() {
    _city.dispose();
    super.dispose();
  }

  static DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

  Future<void> _pickDates() async {
    final now = _dateOnly(DateTime.now());
    final picked = await showDateRangePicker(
      context: context,
      initialDateRange: _range,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() {
        // Guarantee at least one night even if the picker returns a single day.
        _range = picked.start == picked.end
            ? DateTimeRange(start: picked.start, end: picked.start.add(const Duration(days: 1)))
            : picked;
      });
    }
  }

  void _search() {
    final city = _city.text.trim();
    if (city.isEmpty) return;
    FocusScope.of(context).unfocus();
    ref.read(hotelSearchQueryProvider.notifier).state = HotelSearchQuery(
      city: city,
      checkIn: _range.start,
      checkOut: _range.end,
      guests: _guests,
    );
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final query = ref.watch(hotelSearchQueryProvider);
    final nights = _range.duration.inDays;

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const SizedBox(height: 8),
            Text('Book a', style: text.headlineMedium),
            Text('hotel by the night', style: text.headlineMedium?.copyWith(color: AppColors.accent)),
            const SizedBox(height: 6),
            Text(
              'Live nightly prices and availability for your exact dates — the amount you pay is set by our server.',
              style: text.bodyMedium,
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _city,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _search(),
              decoration: InputDecoration(
                labelText: 'City',
                hintText: 'e.g. Bengaluru',
                prefixIcon: const Icon(Icons.location_city),
                filled: true,
                fillColor: AppColors.card,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 12),
            _DatesField(range: _range, nights: nights, onTap: _pickDates),
            const SizedBox(height: 12),
            _GuestsStepper(
              guests: _guests,
              onChanged: (g) => setState(() => _guests = g),
            ),
            const SizedBox(height: 16),
            PrimaryButton(label: 'Search hotels', icon: Icons.search, expand: true, onPressed: _search),
            const SizedBox(height: 24),
            if (query == null)
              Text('Enter a city and your check-in / check-out dates to see available hotels.',
                  style: text.bodyMedium?.copyWith(color: AppColors.mutedInk))
            else
              _Results(query: query),
          ],
        ),
      ),
    );
  }
}

class _DatesField extends StatelessWidget {
  const _DatesField({required this.range, required this.nights, required this.onTap});

  final DateTimeRange range;
  final int nights;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(color: AppColors.card, borderRadius: BorderRadius.circular(14)),
        child: Row(
          children: [
            const Icon(Icons.calendar_today, size: 20, color: AppColors.mutedInk),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${_fmt(range.start)}  →  ${_fmt(range.end)}', style: text.bodyLarge),
                  Text('$nights night${nights == 1 ? '' : 's'}', style: text.bodySmall?.copyWith(color: AppColors.mutedInk)),
                ],
              ),
            ),
            const Icon(Icons.edit_calendar_outlined, size: 18, color: AppColors.faintInk),
          ],
        ),
      ),
    );
  }

  static String _fmt(DateTime d) => '${d.day}/${d.month}/${d.year}';
}

class _GuestsStepper extends StatelessWidget {
  const _GuestsStepper({required this.guests, required this.onChanged});

  final int guests;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(color: AppColors.card, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          const Icon(Icons.group_outlined, size: 20, color: AppColors.mutedInk),
          const SizedBox(width: 12),
          Expanded(child: Text('$guests guest${guests == 1 ? '' : 's'}', style: text.bodyLarge)),
          IconButton(
            onPressed: guests > 1 ? () => onChanged(guests - 1) : null,
            icon: const Icon(Icons.remove_circle_outline),
          ),
          IconButton(
            onPressed: guests < 20 ? () => onChanged(guests + 1) : null,
            icon: const Icon(Icons.add_circle_outline),
          ),
        ],
      ),
    );
  }
}

/// The results section — watches the server search. A masked listing (no real
/// name/address pre-booking) with its per-night price + free-room count.
class _Results extends ConsumerWidget {
  const _Results({required this.query});

  final HotelSearchQuery query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(hotelSearchProvider(query));
    return async.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 40),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => _ResultsMessage(
        message: apiExceptionFrom(e).message,
        onRetry: () => ref.invalidate(hotelSearchProvider(query)),
      ),
      data: (res) {
        if (res.items.isEmpty) {
          return _ResultsMessage(
            message: 'No hotels have rooms available in ${query.city} for these dates. '
                'Try different dates or another city.',
          );
        }
        final text = Theme.of(context).textTheme;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${res.items.length} hotel${res.items.length == 1 ? '' : 's'} · '
              '${res.nights} night${res.nights == 1 ? '' : 's'} · ${res.checkIn} → ${res.checkOut}',
              style: text.bodySmall?.copyWith(color: AppColors.mutedInk),
            ),
            const SizedBox(height: 12),
            for (final result in res.items)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: _HotelCard(
                  result: result,
                  onTap: () => context.push(
                    '/tenant/hotels/${result.listing.id}',
                    extra: HotelDetailArgs(
                      result: result,
                      checkIn: query.checkIn,
                      checkOut: query.checkOut,
                      guests: query.guests,
                      nights: res.nights,
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _HotelCard extends StatelessWidget {
  const _HotelCard({required this.result, required this.onTap});

  final HotelSearchResult result;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final listing = result.listing;
    final from = result.fromPerNight;
    final freeRooms = result.freeRooms;
    return DecoratedBox(
      decoration: const BoxDecoration(color: AppColors.card, borderRadius: AppRadii.cardBorder, boxShadow: AppShadows.card),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadii.cardBorder,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                child: AspectRatio(
                  aspectRatio: 16 / 9,
                  child: CoverImage(url: listing.coverPhoto?.url),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.hotel, size: 16, color: AppColors.agentVisited),
                        const SizedBox(width: 6),
                        Expanded(child: Text(listing.alias, style: text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis)),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text('${listing.areaLabel}, ${listing.city}', style: text.bodySmall?.copyWith(color: AppColors.mutedInk)),
                    const SizedBox(height: 6),
                    Text(
                      '${result.categories.length} room type${result.categories.length == 1 ? '' : 's'} · '
                      '$freeRooms room${freeRooms == 1 ? '' : 's'} free for your dates',
                      style: text.bodySmall?.copyWith(color: freeRooms > 0 ? AppColors.verified : AppColors.faintInk),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text('from ', style: text.bodySmall),
                        if (from != null) PriceText(from, fontSize: 16, color: AppColors.accent),
                        Text(' /night', style: text.bodySmall),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ResultsMessage extends StatelessWidget {
  const _ResultsMessage({required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: AppColors.paperAlt, borderRadius: BorderRadius.circular(14)),
      child: Column(
        children: [
          Text(message, textAlign: TextAlign.center),
          if (onRetry != null) ...[
            const SizedBox(height: 12),
            SecondaryButton(label: 'Try again', onPressed: onRetry),
          ],
        ],
      ),
    );
  }
}
