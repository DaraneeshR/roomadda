import '../../visits/domain/agent_visit.dart';

/// Mirrors `GET /v1/agent/dashboard` — the agent's home queue + actionable counts.
/// Today's visits arrive in schedule order; the counts are server-computed (the
/// app never derives money/booking totals — see /CLAUDE.md one-metric-layer rule).
class AgentDashboard {
  final List<AgentVisit> todaysVisits;

  /// Agent-attributed bookings still awaiting the USER's payment.
  final int pendingAssistedBookings;

  /// Agent-attributed bookings CONFIRMED this calendar month (assisted + walk-in).
  final int closedThisMonth;

  final DateTime generatedAt;

  const AgentDashboard({
    required this.todaysVisits,
    required this.pendingAssistedBookings,
    required this.closedThisMonth,
    required this.generatedAt,
  });

  int get visitsRemaining => todaysVisits.where((v) => v.isScheduled).length;
  int get visitsDoneToday => todaysVisits.where((v) => v.isCompleted).length;

  factory AgentDashboard.fromJson(Map<String, dynamic> json) => AgentDashboard(
        todaysVisits: (json['todaysVisits'] as List<dynamic>)
            .map((e) => AgentVisit.fromJson(e as Map<String, dynamic>))
            .toList(),
        pendingAssistedBookings: (json['pendingAssistedBookings'] as num).toInt(),
        closedThisMonth: (json['closedThisMonth'] as num).toInt(),
        generatedAt: DateTime.parse(json['generatedAt'] as String),
      );
}
