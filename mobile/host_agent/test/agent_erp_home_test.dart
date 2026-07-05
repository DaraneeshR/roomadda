import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/agent/erp/domain/agent_erp_home.dart';

void main() {
  test('AgentErpHome.fromJson parses the scoped self-only snapshot (money as paise)', () {
    final h = AgentErpHome.fromJson({
      'periodMonth': '2026-07-01T00:00:00.000Z',
      'periodLabel': 'July 2026',
      'bookingCount': 4,
      'approvedCount': 2,
      'commissionEarnedPaise': 500000,
      'rank': 2,
      'totalAgents': 7,
      'generatedAt': '2026-07-05T08:00:00.000Z',
    });
    expect(h.periodLabel, 'July 2026');
    expect(h.bookingCount, 4);
    expect(h.approvedCount, 2);
    expect(h.commissionEarned.value, 500000); // integer paise, never float
    expect(h.rank, 2);
    expect(h.totalAgents, 7);
    expect(h.rankLabel, '#2 of 7');
  });

  test('a null rank (no commission yet) renders as a dash', () {
    final h = AgentErpHome.fromJson({
      'periodMonth': '2026-07-01T00:00:00.000Z',
      'periodLabel': 'July 2026',
      'bookingCount': 1,
      'approvedCount': 0,
      'commissionEarnedPaise': 0,
      'rank': null,
      'totalAgents': 3,
      'generatedAt': '2026-07-05T08:00:00.000Z',
    });
    expect(h.rank, isNull);
    expect(h.rankLabel, '—');
  });
}
