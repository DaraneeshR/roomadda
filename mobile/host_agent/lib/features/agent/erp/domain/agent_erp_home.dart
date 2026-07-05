import 'package:roomadda_core/roomadda_core.dart';

/// Mirrors `GET /v1/agent/erp/home` (§15.4) — the agent's SCOPED month snapshot:
/// their own bookings / approved / commission / leaderboard rank. This is a
/// self-only view: the server returns NO other agent's figures and NO
/// company-finance amount (owner payouts, collections, net, settlements). The app
/// never computes money (one-metric-layer rule) — [commissionEarned] is
/// server-provided in integer paise. [rank] is null when nothing was earned yet.
class AgentErpHome {
  final DateTime periodMonth;
  final String periodLabel;
  final int bookingCount;
  final int approvedCount;
  final Paise commissionEarned;
  final int? rank;
  final int totalAgents;
  final DateTime generatedAt;

  const AgentErpHome({
    required this.periodMonth,
    required this.periodLabel,
    required this.bookingCount,
    required this.approvedCount,
    required this.commissionEarned,
    required this.rank,
    required this.totalAgents,
    required this.generatedAt,
  });

  factory AgentErpHome.fromJson(Map<String, dynamic> json) => AgentErpHome(
        periodMonth: DateTime.parse(json['periodMonth'] as String),
        periodLabel: json['periodLabel'] as String,
        bookingCount: (json['bookingCount'] as num).toInt(),
        approvedCount: (json['approvedCount'] as num).toInt(),
        commissionEarned: Paise((json['commissionEarnedPaise'] as num).toInt()),
        rank: json['rank'] == null ? null : (json['rank'] as num).toInt(),
        totalAgents: (json['totalAgents'] as num).toInt(),
        generatedAt: DateTime.parse(json['generatedAt'] as String),
      );

  /// A display label for the leaderboard standing (e.g. "#2 of 7", or "—").
  String get rankLabel => rank == null ? '—' : '#$rank of $totalAgents';
}
