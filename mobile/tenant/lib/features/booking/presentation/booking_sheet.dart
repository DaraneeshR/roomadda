import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../discovery/domain/listing.dart';
import '../../kyc/application/kyc_controller.dart';
import '../data/booking_repository.dart';
import '../domain/move_in_date.dart';

/// Open the booking sheet for a listing (PRD "Booking Initiation"). Collects
/// room / move-in date / meal plan, shows the token-vs-rent summary + the
/// cancellation policy, gates on KYC, then creates the hold and routes to the
/// payment screen (Instant Book) or the await-approval screen (Request-to-Book).
Future<void> showBookingSheet(BuildContext context, PublicListing listing) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.paper,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (_) => _BookingSheet(listing: listing),
  );
}

class _BookingSheet extends ConsumerStatefulWidget {
  const _BookingSheet({required this.listing});
  final PublicListing listing;

  @override
  ConsumerState<_BookingSheet> createState() => _BookingSheetState();
}

class _BookingSheetState extends ConsumerState<_BookingSheet> {
  ListingRoom? _room;
  late DateTime _moveIn;
  String? _mealPlan;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _moveIn = firstSelectableMoveInDate(DateTime.now());
    _room = widget.listing.rooms.where((r) => r.hasAvailability).cast<ListingRoom?>().firstWhere((_) => true, orElse: () => null);
  }

  Paise _token(ListingRoom room) => room.deposit.value > 0 ? room.deposit : room.monthlyRent;

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _moveIn,
      firstDate: firstSelectableMoveInDate(now),
      lastDate: now.add(const Duration(days: 365)),
      selectableDayPredicate: (d) => isSelectableMoveInDate(d, now: now),
    );
    if (picked != null) setState(() => _moveIn = picked);
  }

  Future<void> _confirm() async {
    final room = _room;
    if (room == null) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final booking = await ref
          .read(bookingRepositoryProvider)
          .createHoldForRoom(room.id, moveInDate: _moveIn, mealPlan: _mealPlan);
      if (!mounted) return;
      Navigator.of(context).pop(); // close the sheet
      // Instant Book is immediately payable; Request-to-Book waits for the host.
      if (booking.isPendingApproval) {
        context.push('/tenant/booking/${booking.id}/await');
      } else {
        context.push('/tenant/booking/${booking.id}/pay');
      }
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
    final text = Theme.of(context).textTheme;
    final listing = widget.listing;
    final room = _room;
    final kyc = ref.watch(kycStatusProvider);

    return SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 16,
          bottom: 20 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Book ${listing.alias}', style: text.titleLarge),
            const SizedBox(height: 12),

            Text('Room type', style: text.titleSmall),
            const SizedBox(height: 8),
            ...listing.rooms.map((r) {
              final selected = room?.id == r.id;
              return Card(
                margin: const EdgeInsets.symmetric(vertical: 4),
                color: selected ? AppColors.accentWash : AppColors.card,
                child: ListTile(
                  enabled: r.hasAvailability,
                  onTap: r.hasAvailability ? () => setState(() => _room = r) : null,
                  leading: Icon(
                    selected ? Icons.radio_button_checked : Icons.radio_button_off,
                    color: selected ? AppColors.accent : AppColors.faintInk,
                  ),
                  title: Text('${r.name} · ${_sharing(r.sharingType)}'),
                  subtitle: Text(r.hasAvailability ? '${r.availableBeds} bed(s) available' : 'Full'),
                  trailing: PriceText(r.monthlyRent, fontSize: 14),
                ),
              );
            }),
            const SizedBox(height: 8),

            Text('Move-in date', style: text.titleSmall),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.calendar_today, size: 18),
              label: Text('${_moveIn.day}/${_moveIn.month}/${_moveIn.year}'),
              onPressed: _pickDate,
            ),
            const SizedBox(height: 16),

            Text('Meal plan', style: text.titleSmall),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              for (final m in const ['Veg', 'Non-veg', 'No meals'])
                ChoiceChip(
                  label: Text(m),
                  selected: _mealPlan == m,
                  onSelected: (s) => setState(() => _mealPlan = s ? m : null),
                ),
            ]),
            const SizedBox(height: 16),

            if (room != null) _Summary(room: room, token: _token(room)),
            const SizedBox(height: 12),
            const _CancellationPolicy(),

            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(color: AppColors.accent)),
            ],
            const SizedBox(height: 20),
            _cta(kyc, room),
          ],
        ),
      ),
    );
  }

  Widget _cta(AsyncValue<dynamic> kyc, ListingRoom? room) {
    if (room == null) {
      return const PrimaryButton(label: 'No rooms available', expand: true);
    }
    // Payment is blocked server-side until KYC is VERIFIED — gate it here.
    return kyc.when(
      loading: () => const PrimaryButton(label: 'Checking KYC…', expand: true),
      error: (_, __) => PrimaryButton(
        label: 'Retry',
        expand: true,
        onPressed: () => ref.invalidate(kycStatusProvider),
      ),
      data: (view) {
        if (!(view.isVerified as bool)) {
          return PrimaryButton(
            label: 'Complete KYC to book',
            expand: true,
            icon: Icons.verified_user_outlined,
            onPressed: () async {
              Navigator.of(context).pop();
              await context.push('/tenant/kyc');
            },
          );
        }
        final label = widget.listing.instantBook ? 'Book now — pay token' : 'Request to book';
        return PrimaryButton(label: _submitting ? 'Please wait…' : label, expand: true, onPressed: _submitting ? null : _confirm);
      },
    );
  }
}

String _sharing(int t) => switch (t) {
      1 => 'Single',
      2 => 'Double',
      3 => 'Triple',
      _ => '$t-sharing',
    };

class _Summary extends StatelessWidget {
  const _Summary({required this.room, required this.token});
  final ListingRoom room;
  final Paise token;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(color: AppColors.card, borderRadius: AppRadii.cardBorder, boxShadow: AppShadows.card),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          children: [
            _row(context, 'Pay now (token)', token, accent: true),
            const SizedBox(height: 6),
            _row(context, 'Monthly rent', room.monthlyRent),
            const SizedBox(height: 6),
            _row(context, 'Security deposit', room.deposit),
            const SizedBox(height: 8),
            Text(
              "The token secures your bed and adjusts against your first month's rent.",
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(BuildContext context, String label, Paise amount, {bool accent = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodyMedium),
        PriceText(amount, fontSize: 15, color: accent ? AppColors.accent : AppColors.ink),
      ],
    );
  }
}

class _CancellationPolicy extends StatelessWidget {
  const _CancellationPolicy();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppColors.paperAlt, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Cancellation policy', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 4),
          Text(
            'Full refund if cancelled more than 7 days before move-in · 50% refund 3–7 days before · no refund within 3 days.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
