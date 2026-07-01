import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../listings/data/host_listing_repository.dart';
import '../../requests/data/booking_request_repository.dart';
import '../../service/data/host_service_repository.dart';
import '../data/revenue_repository.dart';
import '../domain/host_dashboard.dart';

/// The host home rollup, composed app-side from several endpoints (there is no
/// single host-dashboard endpoint): the host's listings + each listing's revenue,
/// the pending booking-request count, and the service-queue stats. The
/// requests/service/revenue calls fan out in parallel; one slow call doesn't
/// serialize the rest.
final hostDashboardProvider = FutureProvider.autoDispose<HostDashboard>((ref) async {
  final listingRepo = ref.read(hostListingRepositoryProvider);
  final revenueRepo = ref.read(revenueRepositoryProvider);
  final requestRepo = ref.read(bookingRequestRepositoryProvider);
  final serviceRepo = ref.read(hostServiceRepositoryProvider);

  final page = await listingRepo.list(limit: 50);

  // Fan out: every listing's revenue + the pending requests + the queue stats.
  final revenuesFuture = Future.wait(page.items.map((l) => revenueRepo.summary(l.id)));
  final pendingFuture = requestRepo.list(status: 'PENDING_APPROVAL', limit: 50);
  final statsFuture = serviceRepo.queue(limit: 1);

  final revenues = await revenuesFuture;
  final pending = await pendingFuture;
  final stats = (await statsFuture).stats;

  return HostDashboard.from(
    listings: page.items,
    revenues: revenues,
    pendingRequests: pending.items.length,
    openServiceRequests: stats.openCount,
    escalatedServiceRequests: stats.escalatedCount,
  );
});
