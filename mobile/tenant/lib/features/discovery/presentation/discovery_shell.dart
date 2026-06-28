import 'package:flutter/material.dart';

import '../../booking/presentation/my_bookings_screen.dart';
import '../../wishlist/presentation/wishlist_screen.dart';
import 'home_screen.dart';

/// Tenant home shell — bottom tabs for Search (discovery home), Saved (wishlist)
/// and Bookings. State is preserved across tabs via an IndexedStack.
class DiscoveryShell extends StatefulWidget {
  const DiscoveryShell({super.key});

  @override
  State<DiscoveryShell> createState() => _DiscoveryShellState();
}

class _DiscoveryShellState extends State<DiscoveryShell> {
  int _index = 0;

  static const _tabs = [
    DiscoveryHomeScreen(),
    WishlistScreen(),
    MyBookingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: _tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.search), label: 'Search'),
          NavigationDestination(
            icon: Icon(Icons.favorite_border),
            selectedIcon: Icon(Icons.favorite),
            label: 'Saved',
          ),
          NavigationDestination(icon: Icon(Icons.book_online), label: 'Bookings'),
        ],
      ),
    );
  }
}
