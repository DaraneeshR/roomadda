import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/menu_provider.dart';
import '../domain/meal_menu.dart';

/// The tenant's meal-menu view (lives inside the dashboard's Menu tab — no
/// Scaffold of its own). Shows today's B/L/D, swipes to tomorrow, renders empty
/// slots as "Not available today" and an absent day as "Menu not updated yet",
/// and is transparent about who last updated the menu and when.
class MenuScreen extends ConsumerStatefulWidget {
  const MenuScreen({super.key, required this.listingId});

  final String listingId;

  @override
  ConsumerState<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends ConsumerState<MenuScreen> {
  final _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _goTo(int i) {
    _controller.animateToPage(i, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(menuProvider(widget.listingId));
    final text = Theme.of(context).textTheme;

    return SafeArea(
      top: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Row(
              children: [
                Expanded(child: Text('Meal menu', style: text.headlineSmall)),
                IconButton(
                  icon: const Icon(Icons.refresh),
                  tooltip: 'Refresh',
                  onPressed: () => ref.invalidate(menuProvider(widget.listingId)),
                ),
              ],
            ),
          ),
          Expanded(
            child: async.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Padding(padding: const EdgeInsets.all(24), child: Text(apiExceptionFrom(e).message, textAlign: TextAlign.center)),
              ),
              data: (days) {
                if (days.isEmpty) return const _EmptyDay();
                return Column(
                  children: [
                    _DayToggle(count: days.length, selected: _index, onSelect: _goTo),
                    Expanded(
                      child: PageView.builder(
                        controller: _controller,
                        onPageChanged: (i) => setState(() => _index = i),
                        itemCount: days.length,
                        itemBuilder: (_, i) => _DayView(day: days[i]),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Today / Tomorrow segmented control mirroring the page view.
class _DayToggle extends StatelessWidget {
  const _DayToggle({required this.count, required this.selected, required this.onSelect});

  final int count;
  final int selected;
  final ValueChanged<int> onSelect;

  static const _labels = ['Today', 'Tomorrow'];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Row(
        children: [
          for (var i = 0; i < count; i++) ...[
            if (i > 0) const SizedBox(width: 8),
            Expanded(
              child: _ToggleChip(
                label: i < _labels.length ? _labels[i] : 'Day ${i + 1}',
                selected: i == selected,
                onTap: () => onSelect(i),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ToggleChip extends StatelessWidget {
  const _ToggleChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.accent : AppColors.card,
      borderRadius: AppRadii.pillBorder,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                color: selected ? AppColors.onAccent : AppColors.mutedInk,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DayView extends StatelessWidget {
  const _DayView({required this.day});

  final MealMenuDay day;

  @override
  Widget build(BuildContext context) {
    if (day.notUpdated) return const _EmptyDay();

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      children: [
        _SlotCard(label: 'Breakfast', icon: Icons.free_breakfast_outlined, slot: day.breakfast),
        const SizedBox(height: 12),
        _SlotCard(label: 'Lunch', icon: Icons.lunch_dining_outlined, slot: day.lunch),
        const SizedBox(height: 12),
        _SlotCard(label: 'Dinner', icon: Icons.dinner_dining_outlined, slot: day.dinner),
        const SizedBox(height: 16),
        if (day.updatedAt != null)
          Text(
            'Updated by ${day.updatedByHostName ?? 'your host'} · ${_fmtDateTime(day.updatedAt!.toLocal())}',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.faintInk),
          ),
      ],
    );
  }
}

class _SlotCard extends StatelessWidget {
  const _SlotCard({required this.label, required this.icon, required this.slot});

  final String label;
  final IconData icon;
  final MealSlot slot;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final available = slot.hasDish;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadii.cardBorder,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: available ? AppColors.accent : AppColors.faintInk),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label.toUpperCase(), style: AppTypography.eyebrow),
                  const SizedBox(height: 4),
                  Text(
                    available ? slot.text!.trim() : 'Not available today',
                    style: available
                        ? text.bodyLarge
                        : text.bodyMedium?.copyWith(color: AppColors.faintInk, fontStyle: FontStyle.italic),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyDay extends StatelessWidget {
  const _EmptyDay();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.restaurant_menu_outlined, size: 40, color: AppColors.faintInk),
            const SizedBox(height: 16),
            Text('Menu not updated yet', style: text.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(
              "Your host hasn't posted this day's menu yet. Check back a little later.",
              style: text.bodyMedium?.copyWith(color: AppColors.mutedInk),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// "28 Jun 2026, 14:30" — dependency-free (no intl in the tenant app).
String _fmtDateTime(DateTime d) {
  final hh = d.hour.toString().padLeft(2, '0');
  final mm = d.minute.toString().padLeft(2, '0');
  return '${d.day} ${_months[d.month - 1]} ${d.year}, $hh:$mm';
}
