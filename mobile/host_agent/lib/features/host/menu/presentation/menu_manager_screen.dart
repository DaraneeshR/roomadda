import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../application/menu_providers.dart';
import '../data/menu_repository.dart';
import '../domain/meal_menu.dart';
import 'template_editor_sheet.dart';

/// Meal menu manager: edit today's and tomorrow's three slots (each a dish + a
/// "not served" toggle) and manage saved weekly templates (apply / delete / new).
/// A write pushes a silent update to the listing's tenants (server-side).
class MenuManagerScreen extends ConsumerWidget {
  const MenuManagerScreen({super.key, required this.listingId});
  final String listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final days = ref.watch(menuDaysProvider(listingId));
    return Scaffold(
      appBar: AppBar(title: const Text('Meal menu')),
      body: HostAsync<List<MealMenuDay>>(
        value: days,
        onRetry: () => ref.invalidate(menuDaysProvider(listingId)),
        skeleton: const SkeletonList(count: 2, height: 220),
        data: (menu) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(menuDaysProvider(listingId));
            ref.invalidate(menuTemplatesProvider(listingId));
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
            children: [
              for (var i = 0; i < menu.length; i++)
                _DayEditor(
                  listingId: listingId,
                  label: i == 0 ? 'Today' : 'Tomorrow',
                  day: menu[i],
                ),
              const SizedBox(height: 12),
              _TemplatesSection(listingId: listingId),
            ],
          ),
        ),
      ),
    );
  }
}

class _DayEditor extends ConsumerStatefulWidget {
  const _DayEditor({required this.listingId, required this.label, required this.day});
  final String listingId;
  final String label;
  final MealMenuDay day;

  @override
  ConsumerState<_DayEditor> createState() => _DayEditorState();
}

class _DayEditorState extends ConsumerState<_DayEditor> {
  late final Map<String, TextEditingController> _text;
  late final Map<String, bool> _notAvailable;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final d = widget.day;
    _text = {
      'breakfast': TextEditingController(text: d.breakfast.text ?? ''),
      'lunch': TextEditingController(text: d.lunch.text ?? ''),
      'dinner': TextEditingController(text: d.dinner.text ?? ''),
    };
    _notAvailable = {
      'breakfast': d.breakfast.notAvailable,
      'lunch': d.lunch.notAvailable,
      'dinner': d.dinner.notAvailable,
    };
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  MealSlot _slot(String name) {
    final t = _text[name]!.text.trim();
    return MealSlot(text: t.isEmpty ? null : t, notAvailable: _notAvailable[name]!);
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ref.read(menuRepositoryProvider).writeDay(
            widget.listingId,
            date: widget.day.date,
            breakfast: _slot('breakfast'),
            lunch: _slot('lunch'),
            dinner: _slot('dinner'),
          );
      ref.invalidate(menuDaysProvider(widget.listingId));
      if (mounted) _snack('${widget.label}\'s menu saved');
    } catch (e) {
      if (mounted) _snack(apiExceptionFrom(e).message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: HostCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(widget.label, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(width: 8),
                Text(DateFormat.MMMd().format(widget.day.date), style: Theme.of(context).textTheme.bodySmall),
                const Spacer(),
                if (widget.day.notUpdated) const HostPill(label: 'Not set', color: AppColors.sponsored),
              ],
            ),
            const SizedBox(height: 8),
            for (final slot in mealSlotNames) _slotRow(slot),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: _saving
                  ? const Padding(padding: EdgeInsets.all(8), child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)))
                  : PrimaryButton(label: 'Save', icon: Icons.save_outlined, onPressed: _save),
            ),
          ],
        ),
      ),
    );
  }

  Widget _slotRow(String slot) {
    final off = _notAvailable[slot]!;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(mealSlotLabel(slot), style: AppTypography.eyebrow),
              const Spacer(),
              Text('Not served', style: Theme.of(context).textTheme.bodySmall),
              Switch(
                value: off,
                onChanged: (v) => setState(() => _notAvailable[slot] = v),
              ),
            ],
          ),
          TextField(
            controller: _text[slot],
            enabled: !off,
            decoration: InputDecoration(
              hintText: off ? 'Not served this day' : 'e.g. Idli, sambar, chutney',
            ),
          ),
        ],
      ),
    );
  }
}

class _TemplatesSection extends ConsumerWidget {
  const _TemplatesSection({required this.listingId});
  final String listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final templates = ref.watch(menuTemplatesProvider(listingId));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text('Weekly templates', style: Theme.of(context).textTheme.titleMedium)),
            TextButton.icon(
              onPressed: () => _openEditor(context, ref),
              icon: const Icon(Icons.add),
              label: const Text('New'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        templates.when(
          loading: () => const SkeletonBox(height: 60, radius: AppRadii.card),
          error: (e, _) => HostErrorRetry(
            message: apiExceptionFrom(e).message,
            onRetry: () => ref.invalidate(menuTemplatesProvider(listingId)),
          ),
          data: (items) {
            if (items.isEmpty) {
              return const Text('No templates yet. Save one to plan a whole week at once.',
                  style: TextStyle(color: AppColors.mutedInk));
            }
            return Column(
              children: [for (final t in items) _TemplateTile(listingId: listingId, template: t)],
            );
          },
        ),
      ],
    );
  }

  Future<void> _openEditor(BuildContext context, WidgetRef ref) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.paper,
      shape: const RoundedRectangleBorder(borderRadius: AppRadii.sheetBorder),
      builder: (_) => TemplateEditorSheet(listingId: listingId),
    );
    if (saved == true) ref.invalidate(menuTemplatesProvider(listingId));
  }
}

class _TemplateTile extends ConsumerWidget {
  const _TemplateTile({required this.listingId, required this.template});
  final String listingId;
  final MealTemplate template;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: HostCard(
        child: Row(
          children: [
            Expanded(child: Text(template.name, style: Theme.of(context).textTheme.titleSmall)),
            TextButton(onPressed: () => _apply(context, ref), child: const Text('Apply')),
            IconButton(
              icon: const Icon(Icons.delete_outline, color: AppColors.faintInk),
              onPressed: () => _delete(context, ref),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _apply(BuildContext context, WidgetRef ref) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 60)),
      helpText: 'Week starts on',
    );
    if (picked == null || !context.mounted) return;
    try {
      final n = await ref.read(menuRepositoryProvider).applyTemplate(
            listingId,
            templateId: template.id,
            weekStartDate: picked,
          );
      ref.invalidate(menuDaysProvider(listingId));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Applied to $n days')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
      }
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    try {
      await ref.read(menuRepositoryProvider).deleteTemplate(listingId, template.id);
      ref.invalidate(menuTemplatesProvider(listingId));
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
      }
    }
  }
}
