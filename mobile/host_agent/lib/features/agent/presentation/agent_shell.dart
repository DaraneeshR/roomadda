import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

class AgentShell extends ConsumerWidget {
  const AgentShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Agent'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: const Center(child: Text('Visits and cash collection.')),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        onDestinationSelected: (_) {},
        destinations: const [
          NavigationDestination(icon: Icon(Icons.event_available), label: 'Visits'),
          NavigationDestination(icon: Icon(Icons.payments), label: 'Cash'),
        ],
      ),
    );
  }
}
