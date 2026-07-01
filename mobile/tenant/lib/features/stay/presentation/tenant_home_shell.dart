import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../discovery/presentation/discovery_shell.dart';
import '../application/active_stay_provider.dart';
import '../domain/active_stay.dart';
import 'stay_dashboard_screen.dart';

/// Chooses the tenant's home surface from the active-stay state. Once the server
/// reports an active stay (CONFIRMED booking whose move-in date has arrived) the
/// post-move-in dashboard replaces the browse home automatically; otherwise —
/// and while the stay is still loading or errored — browsing stays available
/// (discovery is never gated; see /CLAUDE.md just-in-time rule). Pure so the
/// swap is unit-tested without pumping either heavy shell.
Widget tenantHomeFor(AsyncValue<ActiveStay?> stay) => stay.maybeWhen(
      data: (s) => s != null ? StayDashboardScreen(stay: s) : const DiscoveryShell(),
      orElse: () => const DiscoveryShell(),
    );

/// Tenant root home (mounted at `/tenant`). Watches [activeStayProvider] and
/// swaps between the browse shell and the post-move-in dashboard.
class TenantHomeShell extends ConsumerWidget {
  const TenantHomeShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return tenantHomeFor(ref.watch(activeStayProvider));
  }
}
