import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

class TenantShell extends ConsumerStatefulWidget {
  const TenantShell({super.key});

  @override
  ConsumerState<TenantShell> createState() => _TenantShellState();
}

class _TenantShellState extends ConsumerState<TenantShell> {
  final _bedId = TextEditingController();

  @override
  void dispose() {
    _bedId.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tenant'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Find a PG, hold a bed, and pay the token online.'),
            const SizedBox(height: 24),
            TextField(
              controller: _bedId,
              decoration: const InputDecoration(labelText: 'Bed id', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () {
                final id = _bedId.text.trim();
                if (id.isNotEmpty) context.go('/tenant/booking/$id/pay');
              },
              child: const Text('Proceed to token payment'),
            ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        onDestinationSelected: (index) {
          if (index == 1) context.push('/tenant/bookings');
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.search), label: 'Search'),
          NavigationDestination(icon: Icon(Icons.book_online), label: 'Bookings'),
        ],
      ),
    );
  }
}
