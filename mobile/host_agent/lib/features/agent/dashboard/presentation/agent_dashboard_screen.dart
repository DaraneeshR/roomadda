import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/agent_async.dart';
import '../../common/agent_tab.dart';
import '../../common/agent_widgets.dart';
import '../../visits/domain/agent_visit.dart';
import '../application/dashboard_controller.dart';
import '../domain/agent_dashboard.dart';

/// The agent home: today's assigned visits in order, plus the two actionable
/// counts (assisted bookings awaiting the user's payment; bookings closed this
/// month). Offline-tolerant — a dropped fetch keeps the last-synced queue on
/// screen behind a banner (see [OfflineBody]).
class AgentDashboardScreen extends ConsumerWidget {
  const AgentDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(agentDashboardControllerProvider);
    return OfflineBody<AgentDashboard>(
      state: state,
      onRetry: () => ref.read(agentDashboardControllerProvider.notifier).refresh(),
      skeleton: const SkeletonList(count: 4, height: 88),
      data: (dash) => RefreshIndicator(
        onRefresh: () => ref.read(agentDashboardControllerProvider.notifier).refresh(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          children: [
            Row(
              children: [
                Expanded(child: AgentStatTile(
                  label: 'Awaiting payment',
                  value: '${dash.pendingAssistedBookings}',
                  sublabel: 'assisted bookings',
                  icon: Icons.hourglass_bottom,
                  accent: AppColors.sponsored,
                )),
                const SizedBox(width: 12),
                Expanded(child: AgentStatTile(
                  label: 'Closed this month',
                  value: '${dash.closedThisMonth}',
                  sublabel: 'assisted + walk-in',
                  icon: Icons.verified,
                  accent: AppColors.verified,
                )),
              ],
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Text("Today's visits", style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                if (dash.todaysVisits.isNotEmpty)
                  Text('${dash.visitsRemaining} to go · ${dash.visitsDoneToday} done',
                      style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
            const SizedBox(height: 8),
            if (dash.todaysVisits.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(
                  child: Text('No visits scheduled today.', style: TextStyle(color: AppColors.mutedInk)),
                ),
              )
            else
              for (var i = 0; i < dash.todaysVisits.length; i++) ...[
                _VisitTile(index: i + 1, visit: dash.todaysVisits[i]),
                const SizedBox(height: 12),
              ],
          ],
        ),
      ),
    );
  }
}

class _VisitTile extends StatelessWidget {
  const _VisitTile({required this.index, required this.visit});
  final int index;
  final AgentVisit visit;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AgentCard(
      onTap: () => context.go('/agent/visits/${visit.id}'),
      child: Row(
        children: [
          _orderBadge(index, visit),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(visit.actualName, style: text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text('${visit.areaLabel} · ${DateFormat('h:mm a').format(visit.scheduledAt.toLocal())}',
                    style: text.bodySmall),
                const SizedBox(height: 6),
                _visitBadges(visit),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, color: AppColors.faintInk),
        ],
      ),
    );
  }

  Widget _orderBadge(int index, AgentVisit visit) {
    final done = visit.isCompleted;
    return Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: done ? AppColors.verifiedWash : AppColors.agentVisitedWash,
        shape: BoxShape.circle,
      ),
      child: done
          ? const Icon(Icons.check, size: 18, color: AppColors.verified)
          : Text('$index', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.agentVisited)),
    );
  }

  Widget _visitBadges(AgentVisit visit) {
    final badges = <Widget>[];
    if (visit.hasValidCheckIn) {
      badges.add(const AgentPill(label: 'Checked in', color: AppColors.verified));
    } else if (visit.checkedInOutOfRange) {
      badges.add(const AgentPill(label: 'Out of range', color: AppColors.sponsored));
    }
    if (visit.inspectionSubmitted) {
      badges.add(const AgentPill(label: 'Inspection sent', color: AppColors.agentVisited));
    } else if (!visit.hasValidCheckIn) {
      badges.add(const AgentPill(label: 'Inspection locked', color: AppColors.faintInk));
    }
    if (badges.isEmpty) return const SizedBox.shrink();
    return Wrap(spacing: 6, runSpacing: 6, children: badges);
  }
}

/// Small helper so the shell's "Bookings" CTA can deep-switch tabs if needed.
void goToBookingsTab(WidgetRef ref) => ref.read(agentTabIndexProvider.notifier).state = AgentTab.bookings;
