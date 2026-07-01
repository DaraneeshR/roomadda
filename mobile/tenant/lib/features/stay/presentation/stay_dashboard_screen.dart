import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../chat/presentation/chat_screen.dart';
import '../../menu/presentation/menu_screen.dart';
import '../../rent/presentation/rent_card.dart';
import '../../safety/application/safety_providers.dart';
import '../../safety/presentation/leave_notice_card.dart';
import '../../safety/presentation/sos_sheet.dart';
import '../../service/presentation/service_requests_screen.dart';
import '../domain/active_stay.dart';

/// The post-move-in tenant dashboard. Replaces the browse home once the tenant
/// has an active stay (see [tenantHomeFor]). Carries an always-visible SOS button
/// (top-right) and the quick-action cards (Pay Rent, View Menu, Raise Request,
/// Chat). Bottom nav switches between Home / Menu / Service / Chat / Profile.
class StayDashboardScreen extends StatefulWidget {
  const StayDashboardScreen({super.key, required this.stay});

  final ActiveStay stay;

  @override
  State<StayDashboardScreen> createState() => _StayDashboardScreenState();
}

class _StayDashboardScreenState extends State<StayDashboardScreen> {
  int _index = 0;

  void _goTo(int index) => setState(() => _index = index);

  @override
  Widget build(BuildContext context) {
    final stay = widget.stay;
    final tabs = [
      _DashboardHome(stay: stay, onNavigate: _goTo),
      _MenuTab(stay: stay),
      const _ServiceTab(),
      const _ChatTab(),
      _ProfileTab(stay: stay),
    ];

    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(
        title: Text(stay.pgName, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          // Always-visible SOS — every tab keeps it one tap away (top-right).
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: _SosButton(stay: stay),
          ),
        ],
      ),
      body: IndexedStack(index: _index, children: tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: _goTo,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.restaurant_menu_outlined), selectedIcon: Icon(Icons.restaurant_menu), label: 'Menu'),
          NavigationDestination(icon: Icon(Icons.build_outlined), selectedIcon: Icon(Icons.build), label: 'Service'),
          NavigationDestination(icon: Icon(Icons.chat_bubble_outline), selectedIcon: Icon(Icons.chat_bubble), label: 'Chat'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}

// ── Home tab ────────────────────────────────────────────────────────────────

class _DashboardHome extends StatelessWidget {
  const _DashboardHome({required this.stay, required this.onNavigate});

  final ActiveStay stay;
  final ValueChanged<int> onNavigate;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _StayHeaderCard(stay: stay),
          const SizedBox(height: 16),
          const RentCard(),
          const SizedBox(height: 12),
          const LeaveNoticeCard(),
          const SizedBox(height: 24),
          Text('QUICK ACTIONS', style: AppTypography.eyebrow),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _ActionCard(
                  icon: Icons.payments_outlined,
                  label: 'Pay Rent',
                  onTap: () => context.push('/tenant/rent'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ActionCard(
                  icon: Icons.restaurant_menu_outlined,
                  label: 'View Menu',
                  onTap: () => onNavigate(1),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _ActionCard(
                  icon: Icons.build_outlined,
                  label: 'Raise Request',
                  onTap: () => onNavigate(2),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ActionCard(
                  icon: Icons.chat_bubble_outline,
                  label: 'Chat',
                  onTap: () => onNavigate(3),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StayHeaderCard extends StatelessWidget {
  const _StayHeaderCard({required this.stay});

  final ActiveStay stay;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadii.cardBorder,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('YOU LIVE AT', style: AppTypography.eyebrow),
            const SizedBox(height: 6),
            Text(stay.pgName, style: text.titleLarge),
            const SizedBox(height: 2),
            Text(stay.roomName, style: text.bodyMedium?.copyWith(color: AppColors.mutedInk)),
            const SizedBox(height: 16),
            const Divider(height: 1, color: AppColors.hairline),
            const SizedBox(height: 12),
            _row('Monthly rent', stay.monthlyRent.format()),
            _row('Next rent due', _formatDate(stay.nextRentDueDate)),
            _row('Moved in', _formatDate(stay.moveInDate)),
            _row('Host', stay.hostName),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(color: AppColors.mutedInk)),
            Flexible(child: Text(value, textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w600))),
          ],
        ),
      );
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.card,
      borderRadius: AppRadii.cardBorder,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: AppRadii.cardBorder,
            border: Border.all(color: AppColors.hairline),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, color: AppColors.accent),
                const SizedBox(height: 12),
                Text(label, style: Theme.of(context).textTheme.titleSmall),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── SOS ───────────────────────────────────────────────────────────────────

class _SosButton extends StatelessWidget {
  const _SosButton({required this.stay});

  final ActiveStay stay;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.accent,
      borderRadius: AppRadii.pillBorder,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _showSosSheet(context, stay),
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.sos, size: 18, color: AppColors.onAccent),
              SizedBox(width: 6),
              Text('SOS', style: TextStyle(color: AppColors.onAccent, fontWeight: FontWeight.w800, letterSpacing: 1)),
            ],
          ),
        ),
      ),
    );
  }
}

/// One tap from the dashboard opens this; "Send SOS now" inside is the 2nd tap.
Future<void> _showSosSheet(BuildContext context, ActiveStay stay) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.card,
    shape: const RoundedRectangleBorder(borderRadius: AppRadii.sheetBorder),
    builder: (_) => SosSheet(
      hostName: stay.hostName,
      hostEmergencyNumber: stay.hostEmergencyContactNumber,
    ),
  );
}

// ── Placeholder tabs (modules land post-MVP) ─────────────────────────────────

class _MenuTab extends StatelessWidget {
  const _MenuTab({required this.stay});

  final ActiveStay stay;

  @override
  Widget build(BuildContext context) {
    // Visible only if the PG offers meals for this stay; otherwise a gentle note.
    if (!stay.mealMenuAvailable) {
      return const _Placeholder(
        icon: Icons.restaurant_menu_outlined,
        title: 'No meal plan',
        message: 'You have not opted into meals for this stay.',
      );
    }
    return MenuScreen(listingId: stay.listingId);
  }
}

class _ServiceTab extends StatelessWidget {
  const _ServiceTab();

  @override
  Widget build(BuildContext context) => const ServiceRequestsScreen();
}

class _ChatTab extends StatelessWidget {
  const _ChatTab();

  @override
  Widget build(BuildContext context) => const ChatScreen();
}

class _ProfileTab extends ConsumerWidget {
  const _ProfileTab({required this.stay});

  final ActiveStay stay;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      top: false,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Profile', style: text.headlineSmall),
          const SizedBox(height: 8),
          Text('Currently staying at ${stay.pgName}.', style: text.bodyMedium?.copyWith(color: AppColors.mutedInk)),
          const SizedBox(height: 20),
          const _SafetyPrompt(),
          SecondaryButton(
            label: 'Trusted contacts',
            icon: Icons.contacts_outlined,
            expand: true,
            onPressed: () => context.push('/tenant/trusted-contacts'),
          ),
          const SizedBox(height: 24),
          SecondaryButton(
            label: 'Log out',
            icon: Icons.logout,
            expand: true,
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
    );
  }
}

/// Onboarding nudge: female tenants with no trusted contacts are prompted to add
/// them (so SOS can reach someone). Hidden for everyone else / once set up.
class _SafetyPrompt extends ConsumerWidget {
  const _SafetyPrompt();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gender = ref.watch(selfGenderProvider).valueOrNull;
    final contacts = ref.watch(trustedContactsProvider).valueOrNull;
    final shouldPrompt = gender == 'FEMALE' && contacts != null && contacts.isEmpty;
    if (!shouldPrompt) return const SizedBox.shrink();

    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DecoratedBox(
        decoration: const BoxDecoration(color: AppColors.accentWash, borderRadius: AppRadii.cardBorder),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.shield_outlined, color: AppColors.accent, size: 20),
                  const SizedBox(width: 8),
                  Expanded(child: Text('Set up your safety contacts', style: text.titleSmall)),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Add 1–3 people we can SMS your location to if you ever trigger SOS.',
                style: text.bodySmall?.copyWith(color: AppColors.mutedInk),
              ),
              const SizedBox(height: 12),
              PrimaryButton(
                label: 'Add trusted contacts',
                expand: true,
                onPressed: () => context.push('/tenant/trusted-contacts'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.icon, required this.title, required this.message});

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: AppColors.faintInk),
            const SizedBox(height: 16),
            Text(title, style: text.titleLarge, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(message, style: text.bodyMedium?.copyWith(color: AppColors.mutedInk), textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

/// Friendly date — "28 Jun 2026". Dependency-free (no intl in the tenant app).
String _formatDate(DateTime d) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${d.day} ${months[d.month - 1]} ${d.year}';
}
