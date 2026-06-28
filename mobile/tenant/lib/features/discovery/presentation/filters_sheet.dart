import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/listings_controller.dart';
import '../domain/filters.dart';

/// Amenities the filter offers (a subset of what the API stores).
const _amenityOptions = [
  'WiFi', 'AC', 'Geyser', 'Laundry', 'Parking', 'CCTV', 'Power Backup', 'Gym', 'Study Table', 'TV',
];

const _rentMinRupees = 3000.0;
const _rentMaxRupees = 30000.0;

/// Open the filters sheet. Applies onto the shared [listingsControllerProvider],
/// which re-runs the browse query. (No verified-only filter: the public contract
/// exposes no verified signal — see feature notes.)
Future<void> showFiltersSheet(BuildContext context, WidgetRef ref) {
  final current = ref.read(listingsControllerProvider).filters;
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.paper,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (_) => _FiltersSheet(
      initial: current,
      onApply: (f) {
        ref.read(listingsControllerProvider.notifier).applyFilters(f);
        Navigator.of(context).pop();
      },
    ),
  );
}

class _FiltersSheet extends StatefulWidget {
  const _FiltersSheet({required this.initial, required this.onApply});

  final ListingFilters initial;
  final ValueChanged<ListingFilters> onApply;

  @override
  State<_FiltersSheet> createState() => _FiltersSheetState();
}

class _FiltersSheetState extends State<_FiltersSheet> {
  late RangeValues _rent;
  int? _sharingType;
  String? _gender;
  late Set<String> _amenities;
  DateTime? _moveInDate;

  @override
  void initState() {
    super.initState();
    final f = widget.initial;
    _rent = RangeValues(
      (f.minRentPaise != null ? f.minRentPaise! / 100 : _rentMinRupees).clamp(_rentMinRupees, _rentMaxRupees),
      (f.maxRentPaise != null ? f.maxRentPaise! / 100 : _rentMaxRupees).clamp(_rentMinRupees, _rentMaxRupees),
    );
    _sharingType = f.sharingType;
    _gender = f.gender;
    _amenities = {...f.amenities};
    _moveInDate = f.moveInDate;
  }

  void _apply() {
    final atFullRange = _rent.start <= _rentMinRupees && _rent.end >= _rentMaxRupees;
    widget.onApply(ListingFilters(
      city: widget.initial.city,
      area: widget.initial.area,
      gender: _gender,
      sharingType: _sharingType,
      minRentPaise: atFullRange ? null : (_rent.start * 100).round(),
      maxRentPaise: atFullRange ? null : (_rent.end * 100).round(),
      moveInDate: _moveInDate,
      amenities: _amenities.toList(),
    ));
  }

  void _clearAll() {
    setState(() {
      _rent = const RangeValues(_rentMinRupees, _rentMaxRupees);
      _sharingType = null;
      _gender = null;
      _amenities = {};
      _moveInDate = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text('Filters', style: text.titleLarge),
                  const Spacer(),
                  TextButton(onPressed: _clearAll, child: const Text('Clear all')),
                ],
              ),
              const SizedBox(height: 8),

              Text('Monthly rent', style: text.titleSmall),
              RangeSlider(
                values: _rent,
                min: _rentMinRupees,
                max: _rentMaxRupees,
                divisions: 27,
                activeColor: AppColors.accent,
                labels: RangeLabels(
                  Paise((_rent.start * 100).round()).format(),
                  Paise((_rent.end * 100).round()).format(),
                ),
                onChanged: (v) => setState(() => _rent = v),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  PriceText(Paise((_rent.start * 100).round()), fontSize: 13, color: AppColors.mutedInk),
                  PriceText(Paise((_rent.end * 100).round()), fontSize: 13, color: AppColors.mutedInk),
                ],
              ),
              const SizedBox(height: 16),

              Text('Room type', style: text.titleSmall),
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [
                for (final e in const {1: 'Single', 2: 'Double', 3: 'Triple'}.entries)
                  ChoiceChip(
                    label: Text(e.value),
                    selected: _sharingType == e.key,
                    onSelected: (s) => setState(() => _sharingType = s ? e.key : null),
                  ),
              ]),
              const SizedBox(height: 16),

              Text('Gender', style: text.titleSmall),
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [
                for (final e in const {'MALE': 'Boys', 'FEMALE': 'Girls', 'COED': 'Co-ed'}.entries)
                  ChoiceChip(
                    label: Text(e.value),
                    selected: _gender == e.key,
                    onSelected: (s) => setState(() => _gender = s ? e.key : null),
                  ),
              ]),
              const SizedBox(height: 16),

              Text('Amenities', style: text.titleSmall),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final a in _amenityOptions)
                  FilterChip(
                    label: Text(a),
                    selected: _amenities.contains(a),
                    onSelected: (s) => setState(() => s ? _amenities.add(a) : _amenities.remove(a)),
                  ),
              ]),
              const SizedBox(height: 16),

              Text('Move-in date', style: text.titleSmall),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                icon: const Icon(Icons.calendar_today, size: 18),
                label: Text(_moveInDate == null ? 'Any date' : _formatDate(_moveInDate!)),
                onPressed: () async {
                  final now = DateTime.now();
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _moveInDate ?? now,
                    firstDate: now,
                    lastDate: now.add(const Duration(days: 365)),
                  );
                  if (picked != null) setState(() => _moveInDate = picked);
                },
              ),
              const SizedBox(height: 24),

              PrimaryButton(label: 'Apply filters', expand: true, onPressed: _apply),
            ],
          ),
        ),
      ),
    );
  }
}

String _formatDate(DateTime d) => '${d.day}/${d.month}/${d.year}';
