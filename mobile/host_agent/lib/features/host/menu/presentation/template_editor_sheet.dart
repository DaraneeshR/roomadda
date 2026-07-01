import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/menu_repository.dart';
import '../domain/meal_menu.dart';

/// Builds and saves a named weekly template (Mon→Sun, three slots each). Pops with
/// `true` once saved so the caller can refresh the templates list.
class TemplateEditorSheet extends ConsumerStatefulWidget {
  const TemplateEditorSheet({super.key, required this.listingId});
  final String listingId;

  @override
  ConsumerState<TemplateEditorSheet> createState() => _TemplateEditorSheetState();
}

class _TemplateEditorSheetState extends ConsumerState<TemplateEditorSheet> {
  final _name = TextEditingController();
  // weekday -> slot -> dish text controller. Not-available is implied by an empty
  // dish here (a template plans dishes; per-day "not served" is set on the day).
  late final Map<String, Map<String, TextEditingController>> _fields;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _fields = {
      for (final wd in weekdays)
        wd: {for (final slot in mealSlotNames) slot: TextEditingController()},
    };
  }

  @override
  void dispose() {
    _name.dispose();
    for (final day in _fields.values) {
      for (final c in day.values) {
        c.dispose();
      }
    }
    super.dispose();
  }

  bool get _valid => _name.text.trim().isNotEmpty;

  Future<void> _save() async {
    if (!_valid) return;
    setState(() => _saving = true);
    try {
      final days = <String, WeeklyMenuDay>{
        for (final wd in weekdays)
          wd: WeeklyMenuDay(
            breakfast: _slot(wd, 'breakfast'),
            lunch: _slot(wd, 'lunch'),
            dinner: _slot(wd, 'dinner'),
          ),
      };
      await ref.read(menuRepositoryProvider).saveTemplate(widget.listingId, name: _name.text.trim(), days: days);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
      }
    }
  }

  MealSlot _slot(String wd, String slot) {
    final t = _fields[wd]![slot]!.text.trim();
    return MealSlot(text: t.isEmpty ? null : t, notAvailable: false);
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 16 + bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: const BoxDecoration(color: AppColors.hairlineStrong, borderRadius: AppRadii.pillBorder),
              ),
            ),
            const SizedBox(height: 16),
            Text('New weekly template', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Template name'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            for (final wd in weekdays) _DaySection(weekday: wd, fields: _fields[wd]!),
            const SizedBox(height: 16),
            if (_saving)
              const Center(child: CircularProgressIndicator())
            else
              PrimaryButton(label: 'Save template', icon: Icons.check, expand: true, onPressed: _valid ? _save : null),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

class _DaySection extends StatelessWidget {
  const _DaySection({required this.weekday, required this.fields});
  final String weekday;
  final Map<String, TextEditingController> fields;

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        title: Text(weekdayLabel(weekday), style: Theme.of(context).textTheme.titleSmall),
        children: [
          for (final slot in mealSlotNames)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: TextField(
                controller: fields[slot],
                decoration: InputDecoration(labelText: mealSlotLabel(slot)),
              ),
            ),
        ],
      ),
    );
  }
}
