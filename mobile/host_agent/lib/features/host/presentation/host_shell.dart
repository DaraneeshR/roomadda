import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

class HostShell extends ConsumerWidget {
  const HostShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Host'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: const Center(child: Text('Manage your listings, rooms and beds.')),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        onDestinationSelected: (_) {},
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_work), label: 'Listings'),
          NavigationDestination(icon: Icon(Icons.insights), label: 'Occupancy'),
        ],
      ),
    );
  }
}
