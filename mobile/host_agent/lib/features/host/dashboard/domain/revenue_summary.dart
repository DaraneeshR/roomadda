import 'package:roomadda_core/roomadda_core.dart';

/// Mirrors the `RevenueSummary` / `RevenueMonth` contracts. Read-only snapshot for
/// a host listing (NO payouts in MVP). All figures are integer paise: expected =
/// current-month rent invoices; collected = the PAID subset (a verified webhook is
/// the only thing that marks an invoice paid, /CLAUDE.md); overdue = unpaid past
/// due. Occupancy counts live beds across the listing.
class RevenueSummary {
  final String listingId;
  final Paise expected;
  final Paise collected;
  final Paise overdue;
  final int occupiedBeds;
  final int vacantBeds;
  final int totalBeds;
  final List<RevenueMonth> months;
  final DateTime generatedAt;

  const RevenueSummary({
    required this.listingId,
    required this.expected,
    required this.collected,
    required this.overdue,
    required this.occupiedBeds,
    required this.vacantBeds,
    required this.totalBeds,
    required this.months,
    required this.generatedAt,
  });

  factory RevenueSummary.fromJson(Map<String, dynamic> json) => RevenueSummary(
        listingId: json['listingId'] as String,
        expected: Paise(json['expectedPaise'] as int),
        collected: Paise(json['collectedPaise'] as int),
        overdue: Paise(json['overduePaise'] as int),
        occupiedBeds: json['occupiedBeds'] as int,
        vacantBeds: json['vacantBeds'] as int,
        totalBeds: json['totalBeds'] as int,
        months: (json['months'] as List<dynamic>? ?? const [])
            .map((e) => RevenueMonth.fromJson(e as Map<String, dynamic>))
            .toList(),
        generatedAt: DateTime.parse(json['generatedAt'] as String),
      );
}

class RevenueMonth {
  final DateTime periodMonth;
  final String periodLabel;
  final Paise expected;
  final Paise collected;

  const RevenueMonth({
    required this.periodMonth,
    required this.periodLabel,
    required this.expected,
    required this.collected,
  });

  factory RevenueMonth.fromJson(Map<String, dynamic> json) => RevenueMonth(
        periodMonth: DateTime.parse(json['periodMonth'] as String),
        periodLabel: json['periodLabel'] as String,
        expected: Paise(json['expectedPaise'] as int),
        collected: Paise(json['collectedPaise'] as int),
      );
}
