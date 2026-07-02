import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/agent_async.dart';
import '../../common/agent_widgets.dart';
import '../application/performance_providers.dart';
import '../domain/agent_performance.dart';

/// The agent's read-only performance scorecard for this month: visits completed,
/// bookings closed (assisted + walk-in), and commission earned. Read-only — payout
/// is manual in the MVP and the app never computes any figure (all server-provided).
class PerformanceScreen extends ConsumerWidget {
  const PerformanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(agentPerformanceProvider);
    return AgentAsync<AgentPerformance>(
      value: async,
      onRetry: () => ref.invalidate(agentPerformanceProvider),
      skeleton: const SkeletonList(count: 4, height: 88),
      data: (p) => RefreshIndicator(
        onRefresh: () async => ref.invalidate(agentPerformanceProvider),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          children: [
            Text(p.periodLabel, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            AgentCard(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('COMMISSION EARNED', style: AppTypography.eyebrow),
                  const SizedBox(height: 6),
                  Text(p.commissionEarned.format(),
                      style: AppTypography.priceStyle(fontSize: 34, color: AppColors.agentHeroStart)),
                  const SizedBox(height: 4),
                  const Text('Read-only · paid out manually', style: TextStyle(color: AppColors.mutedInk, fontSize: 12)),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: AgentStatTile(
                  label: 'Visits done',
                  value: '${p.visitsCompleted}',
                  icon: Icons.event_available,
                  accent: AppColors.agentVisited,
                )),
                const SizedBox(width: 12),
                Expanded(child: AgentStatTile(
                  label: 'Bookings closed',
                  value: '${p.bookingsClosed}',
                  icon: Icons.verified,
                  accent: AppColors.verified,
                )),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: AgentStatTile(
                  label: 'Assisted',
                  value: '${p.assistedClosed}',
                  sublabel: 'pay-link bookings',
                  icon: Icons.sms,
                )),
                const SizedBox(width: 12),
                Expanded(child: AgentStatTile(
                  label: 'Walk-in',
                  value: '${p.walkInClosed}',
                  sublabel: 'QR bookings',
                  icon: Icons.qr_code_2,
                )),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
