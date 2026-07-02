import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/agent/performance/domain/agent_performance.dart';

void main() {
  test('AgentPerformance.fromJson parses the read-only scorecard (money as paise)', () {
    final p = AgentPerformance.fromJson({
      'periodMonth': '2026-07-01T00:00:00.000Z',
      'periodLabel': 'July 2026',
      'visitsCompleted': 12,
      'bookingsClosed': 5,
      'assistedClosed': 3,
      'walkInClosed': 2,
      'commissionEarnedPaise': 1250000,
      'generatedAt': '2026-07-01T08:00:00.000Z',
    });
    expect(p.periodLabel, 'July 2026');
    expect(p.visitsCompleted, 12);
    expect(p.bookingsClosed, 5);
    expect(p.assistedClosed, 3);
    expect(p.walkInClosed, 2);
    expect(p.commissionEarned.value, 1250000); // integer paise, never float
    expect(p.assistedClosed + p.walkInClosed, p.bookingsClosed);
  });
}
