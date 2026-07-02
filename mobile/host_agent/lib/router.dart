import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import 'features/agent/inspection/presentation/inspection_screen.dart';
import 'features/agent/presentation/agent_shell.dart';
import 'features/agent/visits/presentation/visit_detail_screen.dart';
import 'features/host/broadcast/presentation/broadcast_screen.dart';
import 'features/host/inventory/presentation/inventory_screen.dart';
import 'features/host/listings/presentation/host_listing_detail_screen.dart';
import 'features/host/listings/presentation/listing_form_screen.dart';
import 'features/host/menu/presentation/menu_manager_screen.dart';
import 'features/host/presentation/host_shell.dart';
import 'features/host/roster/presentation/roster_screen.dart';
import 'features/host/service/presentation/service_request_detail_screen.dart';
import 'features/host/walkin/presentation/walk_in_screen.dart';

/// Host & Agent router. The role switch at the root sends HOST -> `/host` and
/// AGENT -> `/agent`; any other role hits the shared wrong-app gate. The host
/// subtree is the four-tab shell at `/host` with per-listing surfaces and detail
/// screens pushed on top.
final routerProvider = Provider<GoRouter>((ref) {
  return createRouter(
    ref,
    allowedRoles: AppAudience.hostAgent.roles,
    roleHome: (role) => role == UserRole.host ? '/host' : '/agent',
    appRoutes: [
      GoRoute(
        path: '/host',
        builder: (_, __) => const HostShell(),
        routes: [
          // Create flow (no id) must precede the ':id' route so 'new' isn't an id.
          GoRoute(
            path: 'listings/new',
            builder: (_, __) => const ListingFormScreen(),
          ),
          GoRoute(
            path: 'listings/:id',
            builder: (context, state) => HostListingDetailScreen(listingId: state.pathParameters['id']!),
            routes: [
              GoRoute(
                path: 'edit',
                builder: (context, state) => ListingFormScreen(listingId: state.pathParameters['id']!),
              ),
              GoRoute(
                path: 'inventory',
                builder: (context, state) => InventoryScreen(listingId: state.pathParameters['id']!),
              ),
              GoRoute(
                path: 'roster',
                builder: (context, state) => RosterScreen(listingId: state.pathParameters['id']!),
              ),
              GoRoute(
                path: 'menu',
                builder: (context, state) => MenuManagerScreen(listingId: state.pathParameters['id']!),
              ),
              GoRoute(
                path: 'walk-in',
                builder: (context, state) => WalkInScreen(listingId: state.pathParameters['id']!),
              ),
              GoRoute(
                path: 'broadcast',
                builder: (context, state) => BroadcastScreen(listingId: state.pathParameters['id']!),
              ),
            ],
          ),
          GoRoute(
            path: 'service/:id',
            builder: (context, state) => ServiceRequestDetailScreen(requestId: state.pathParameters['id']!),
          ),
        ],
      ),
      GoRoute(
        path: '/agent',
        builder: (_, __) => const AgentShell(),
        routes: [
          GoRoute(
            path: 'visits/:id',
            builder: (context, state) => VisitDetailScreen(visitId: state.pathParameters['id']!),
            routes: [
              GoRoute(
                path: 'inspection',
                builder: (context, state) => InspectionScreen(visitId: state.pathParameters['id']!),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});
