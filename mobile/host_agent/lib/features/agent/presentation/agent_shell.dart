import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../bookings/presentation/new_booking_screen.dart';
import '../common/agent_tab.dart';
import '../dashboard/presentation/agent_dashboard_screen.dart';
import '../erp/presentation/agent_erp_home_screen.dart';
import '../performance/presentation/performance_screen.dart';

/// The AGENT role shell: a four-tab home (Today, Bookings, My ERP, Performance).
/// The "My ERP" tab is the §15.4 scoped self-only finance view (my bookings /
/// approved / commission / rank). The visit → GPS check-in → inspection flow, and
/// the booking result screens, push on top via go_router / the root navigator. The
/// selected tab is held in a provider so a body action can switch tabs.
class AgentShell extends ConsumerWidget {
  const AgentShell({super.key});

  static const _titles = ['Today', 'New booking', 'My ERP', 'Performance'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final index = ref.watch(agentTabIndexProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[index]),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: IndexedStack(
          index: index,
          children: const [
            AgentDashboardScreen(),
            NewBookingScreen(),
            AgentErpHomeScreen(),
            PerformanceScreen(),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => ref.read(agentTabIndexProvider.notifier).state = i,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.today_outlined), selectedIcon: Icon(Icons.today), label: 'Today'),
          NavigationDestination(icon: Icon(Icons.add_business_outlined), selectedIcon: Icon(Icons.add_business), label: 'Bookings'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), selectedIcon: Icon(Icons.account_balance_wallet), label: 'My ERP'),
          NavigationDestination(icon: Icon(Icons.insights_outlined), selectedIcon: Icon(Icons.insights), label: 'Performance'),
        ],
      ),
    );
  }
}
