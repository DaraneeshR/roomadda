import 'package:roomadda_core/roomadda_core.dart';

import '../../listings/domain/host_listing.dart';
import 'revenue_summary.dart';

/// The host home/dashboard rollup. There is no single backend dashboard endpoint
/// for hosts; this is composed app-side from the host's listings, each listing's
/// revenue snapshot, the incoming-requests feed and the service-queue stats. The
/// money figures are summed across the host's whole portfolio (so a single-listing
/// host sees that listing; a multi-listing host sees the total). All money is paise.
class HostDashboard {
  final List<HostListing> listings;
  final Paise expected;
  final Paise collected;
  final Paise overdue;
  final int occupiedBeds;
  final int vacantBeds;
  final int totalBeds;
  final int pendingRequests;
  final int openServiceRequests;
  final int escalatedServiceRequests;

  const HostDashboard({
    required this.listings,
    required this.expected,
    required this.collected,
    required this.overdue,
    required this.occupiedBeds,
    required this.vacantBeds,
    required this.totalBeds,
    required this.pendingRequests,
    required this.openServiceRequests,
    required this.escalatedServiceRequests,
  });

  bool get hasListings => listings.isNotEmpty;
  int get liveListings => listings.where((l) => l.isLive).length;

  /// True when any listing has inventory unverified for 3+ days (drives a nudge).
  bool get hasStaleInventory => listings.any((l) => l.hasStaleInventory);

  /// Collected as a fraction of expected (0..1); 0 when nothing is expected.
  double get collectionRate => expected.value == 0 ? 0 : collected.value / expected.value;

  /// Build the rollup from its parts (listings + their revenue snapshots + counts).
  factory HostDashboard.from({
    required List<HostListing> listings,
    required List<RevenueSummary> revenues,
    required int pendingRequests,
    required int openServiceRequests,
    required int escalatedServiceRequests,
  }) {
    var expected = 0;
    var collected = 0;
    var overdue = 0;
    var occupied = 0;
    var vacant = 0;
    var total = 0;
    for (final r in revenues) {
      expected += r.expected.value;
      collected += r.collected.value;
      overdue += r.overdue.value;
      occupied += r.occupiedBeds;
      vacant += r.vacantBeds;
      total += r.totalBeds;
    }
    return HostDashboard(
      listings: listings,
      expected: Paise(expected),
      collected: Paise(collected),
      overdue: Paise(overdue),
      occupiedBeds: occupied,
      vacantBeds: vacant,
      totalBeds: total,
      pendingRequests: pendingRequests,
      openServiceRequests: openServiceRequests,
      escalatedServiceRequests: escalatedServiceRequests,
    );
  }
}
