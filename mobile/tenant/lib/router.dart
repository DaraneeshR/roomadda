import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import 'features/booking/presentation/booking_payment_screen.dart';
import 'features/booking/presentation/my_bookings_screen.dart';
import 'features/tenant/presentation/tenant_shell.dart';

/// Tenant router. Serves only the TENANT role; the shared gate sends any other
/// role to the wrong-app screen. The route tree is preserved verbatim from the
/// original single-app router (`/tenant` + `bookings` + `booking/:bedId/pay`).
final routerProvider = Provider<GoRouter>((ref) {
  return createRouter(
    ref,
    allowedRoles: AppAudience.tenant.roles,
    roleHome: (_) => '/tenant',
    appRoutes: [
      GoRoute(
        path: '/tenant',
        builder: (_, __) => const TenantShell(),
        routes: [
          GoRoute(
            path: 'bookings',
            builder: (_, __) => const MyBookingsScreen(),
          ),
          GoRoute(
            path: 'booking/:bedId/pay',
            builder: (context, state) =>
                BookingPaymentScreen(bedId: state.pathParameters['bedId']!),
          ),
        ],
      ),
    ],
  );
});
