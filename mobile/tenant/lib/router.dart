import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import 'features/booking/presentation/booking_await_screen.dart';
import 'features/booking/presentation/booking_detail_screen.dart';
import 'features/booking/presentation/booking_payment_screen.dart';
import 'features/discovery/presentation/discovery_shell.dart';
import 'features/discovery/presentation/listing_detail_screen.dart';
import 'features/discovery/presentation/map_screen.dart';
import 'features/discovery/presentation/results_screen.dart';
import 'features/kyc/presentation/kyc_screen.dart';

/// Tenant router. Serves only the TENANT role; the shared gate sends any other
/// role to the wrong-app screen. `/tenant` is the bottom-tab shell (Search /
/// Saved / Bookings); discovery + booking screens push on top.
final routerProvider = Provider<GoRouter>((ref) {
  return createRouter(
    ref,
    allowedRoles: AppAudience.tenant.roles,
    roleHome: (_) => '/tenant',
    appRoutes: [
      GoRoute(
        path: '/tenant',
        builder: (_, __) => const DiscoveryShell(),
        routes: [
          GoRoute(
            path: 'results',
            builder: (_, __) => const ResultsScreen(),
          ),
          GoRoute(
            path: 'listing/:id',
            builder: (context, state) => ListingDetailScreen(listingId: state.pathParameters['id']!),
          ),
          GoRoute(
            path: 'map',
            builder: (_, __) => const MapScreen(),
          ),
          GoRoute(
            path: 'kyc',
            builder: (_, __) => const KycScreen(),
          ),
          GoRoute(
            path: 'booking/:bookingId',
            builder: (context, state) => BookingDetailScreen(bookingId: state.pathParameters['bookingId']!),
          ),
          GoRoute(
            path: 'booking/:bookingId/pay',
            builder: (context, state) => BookingPaymentScreen(bookingId: state.pathParameters['bookingId']!),
          ),
          GoRoute(
            path: 'booking/:bookingId/await',
            builder: (context, state) => BookingAwaitScreen(bookingId: state.pathParameters['bookingId']!),
          ),
        ],
      ),
    ],
  );
});
