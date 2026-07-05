import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/agent_async.dart';
import '../../common/agent_widgets.dart';
import '../application/agent_erp_providers.dart';
import '../domain/agent_erp_home.dart';

/// The agent's SCOPED ERP home (§15.4): my bookings / approved / commission /
/// leaderboard rank — this month, own data only. Deliberately shows the agent's
/// GROSS commission and NOTHING else money-wise; the server never returns another
/// agent's figures nor any company-finance amount, so this screen can't display one.
class AgentErpHomeScreen extends ConsumerWidget {
  const AgentErpHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(agentErpHomeProvider);
    return AgentAsync<AgentErpHome>(
      value: async,
      onRetry: () => ref.invalidate(agentErpHomeProvider),
      skeleton: const SkeletonList(count: 4, height: 88),
      data: (h) => RefreshIndicator(
        onRefresh: () async => ref.invalidate(agentErpHomeProvider),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          children: [
            Text(h.periodLabel, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            AgentCard(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('MY COMMISSION', style: AppTypography.eyebrow),
                  const SizedBox(height: 6),
                  Text(h.commissionEarned.format(),
                      style: AppTypography.priceStyle(fontSize: 34, color: AppColors.agentHeroStart)),
                  const SizedBox(height: 4),
                  const Text('Your own earnings · read-only', style: TextStyle(color: AppColors.mutedInk, fontSize: 12)),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: AgentStatTile(
                  label: 'My bookings',
                  value: '${h.bookingCount}',
                  sublabel: 'this month',
                  icon: Icons.receipt_long,
                )),
                const SizedBox(width: 12),
                Expanded(child: AgentStatTile(
                  label: 'Approved',
                  value: '${h.approvedCount}',
                  sublabel: 'confirmed',
                  icon: Icons.verified,
                  accent: AppColors.verified,
                )),
              ],
            ),
            const SizedBox(height: 12),
            AgentStatTile(
              label: 'Leaderboard rank',
              value: h.rankLabel,
              sublabel: 'by commission this month',
              icon: Icons.leaderboard,
              accent: AppColors.agentHeroStart,
            ),
          ],
        ),
      ),
    );
  }
}
