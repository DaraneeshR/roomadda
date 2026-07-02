import 'package:roomadda_core/roomadda_core.dart';

/// Mirrors `GET /v1/agent/performance` — this month's read-only scorecard. Payout
/// is manual in the MVP, so [commissionEarned] is display-only; the app never
/// computes it (one-metric-layer rule) — it is server-provided in paise.
class AgentPerformance {
  final DateTime periodMonth;
  final String periodLabel;
  final int visitsCompleted;
  final int bookingsClosed;
  final int assistedClosed;
  final int walkInClosed;
  final Paise commissionEarned;
  final DateTime generatedAt;

  const AgentPerformance({
    required this.periodMonth,
    required this.periodLabel,
    required this.visitsCompleted,
    required this.bookingsClosed,
    required this.assistedClosed,
    required this.walkInClosed,
    required this.commissionEarned,
    required this.generatedAt,
  });

  factory AgentPerformance.fromJson(Map<String, dynamic> json) => AgentPerformance(
        periodMonth: DateTime.parse(json['periodMonth'] as String),
        periodLabel: json['periodLabel'] as String,
        visitsCompleted: (json['visitsCompleted'] as num).toInt(),
        bookingsClosed: (json['bookingsClosed'] as num).toInt(),
        assistedClosed: (json['assistedClosed'] as num).toInt(),
        walkInClosed: (json['walkInClosed'] as num).toInt(),
        commissionEarned: Paise((json['commissionEarnedPaise'] as num).toInt()),
        generatedAt: DateTime.parse(json['generatedAt'] as String),
      );
}
