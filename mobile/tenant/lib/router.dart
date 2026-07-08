import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import 'features/booking/presentation/booking_await_screen.dart';
import 'features/booking/presentation/booking_detail_screen.dart';
import 'features/booking/presentation/booking_payment_screen.dart';
import 'features/discovery/presentation/listing_detail_screen.dart';
import 'features/discovery/presentation/map_screen.dart';
import 'features/discovery/presentation/results_screen.dart';
import 'features/hotel/presentation/hotel_detail_screen.dart';
import 'features/hotel/presentation/hotel_reservation_screen.dart';
import 'features/kyc/presentation/kyc_screen.dart';
import 'features/rent/presentation/rent_payment_screen.dart';
import 'features/rent/presentation/rent_screen.dart';
import 'features/safety/presentation/leave_notice_screen.dart';
import 'features/safety/presentation/trusted_contacts_screen.dart';
import 'features/service/presentation/raise_request_screen.dart';
import 'features/service/presentation/service_request_detail_screen.dart';
import 'features/stay/presentation/tenant_home_shell.dart';

/// Tenant router. Serves only the TENANT role; the shared gate sends any other
/// role to the wrong-app screen. `/tenant` is the home shell, which swaps the
/// browse surface (Search / Saved / Bookings) for the post-move-in dashboard
/// once the tenant has an active stay; discovery + booking screens push on top.
final routerProvider = Provider<GoRouter>((ref) {
  return createRouter(
    ref,
    allowedRoles: AppAudience.tenant.roles,
    roleHome: (_) => '/tenant',
    appRoutes: [
      GoRoute(
        path: '/tenant',
        builder: (_, __) => const TenantHomeShell(),
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
          // Hotel detail is booked from exactly what the search returned (no
          // per-listing hotel endpoint exists), so the search result + stay window
          // are passed as `extra`; a deep-link without it falls back to search.
          GoRoute(
            path: 'hotels/:id',
            builder: (context, state) => HotelDetailScreen(
              listingId: state.pathParameters['id']!,
              args: state.extra as HotelDetailArgs?,
            ),
          ),
          GoRoute(
            path: 'hotels/reservation/:id',
            builder: (context, state) => HotelReservationScreen(reservationId: state.pathParameters['id']!),
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
          GoRoute(
            path: 'rent',
            builder: (_, __) => const RentScreen(),
          ),
          GoRoute(
            path: 'rent/:invoiceId/pay',
            builder: (context, state) => RentPaymentScreen(invoiceId: state.pathParameters['invoiceId']!),
          ),
          GoRoute(
            path: 'service/new',
            builder: (_, __) => const RaiseRequestScreen(),
          ),
          GoRoute(
            path: 'service/:id',
            builder: (context, state) => ServiceRequestDetailScreen(requestId: state.pathParameters['id']!),
          ),
          GoRoute(
            path: 'leave-notice',
            builder: (_, __) => const LeaveNoticeScreen(),
          ),
          GoRoute(
            path: 'trusted-contacts',
            builder: (_, __) => const TrustedContactsScreen(),
          ),
        ],
      ),
    ],
  );
});
