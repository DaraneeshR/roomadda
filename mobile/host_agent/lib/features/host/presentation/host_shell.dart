import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../common/host_tab.dart';
import '../dashboard/presentation/host_dashboard_screen.dart';
import '../listings/presentation/host_listings_screen.dart';
import '../requests/presentation/booking_requests_screen.dart';
import '../service/presentation/service_queue_screen.dart';

/// The HOST role shell: a four-tab home (Dashboard, Listings, Requests, Service).
/// Per-listing surfaces (inventory, roster, menu, walk-in, broadcast) and detail
/// screens push on top via go_router. The selected tab is held in a provider so a
/// dashboard action can switch tabs.
class HostShell extends ConsumerWidget {
  const HostShell({super.key});

  static const _titles = ['Dashboard', 'My listings', 'Requests', 'Service'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final index = ref.watch(hostTabIndexProvider);
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
            HostDashboardScreen(),
            HostListingsScreen(),
            BookingRequestsScreen(),
            ServiceQueueScreen(),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => ref.read(hostTabIndexProvider.notifier).state = i,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.home_work_outlined), selectedIcon: Icon(Icons.home_work), label: 'Listings'),
          NavigationDestination(icon: Icon(Icons.inbox_outlined), selectedIcon: Icon(Icons.inbox), label: 'Requests'),
          NavigationDestination(icon: Icon(Icons.build_outlined), selectedIcon: Icon(Icons.build), label: 'Service'),
        ],
      ),
    );
  }
}
