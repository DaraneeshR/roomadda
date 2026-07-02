import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/agent_async.dart';
import '../../common/agent_location.dart';
import '../../common/agent_widgets.dart';
import '../application/check_in_controller.dart';
import '../application/visit_providers.dart';
import '../domain/agent_visit.dart';

/// One property visit: identity + address (unmasked for the agent), the GPS
/// check-in, and the gated inspection entry. The inspection is LOCKED until a
/// server-validated (<=200m) check-in exists — the same gate the backend enforces
/// on submit; an out-of-range check-in is the "cannot reach property" flag path.
class VisitDetailScreen extends ConsumerWidget {
  const VisitDetailScreen({super.key, required this.visitId});
  final String visitId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(visitDetailControllerProvider(visitId));
    return Scaffold(
      appBar: AppBar(title: const Text('Visit')),
      body: OfflineBody<AgentVisit>(
        state: state,
        onRetry: () => ref.read(visitDetailControllerProvider(visitId).notifier).refresh(),
        skeleton: const SkeletonList(count: 3, height: 120),
        data: (visit) => _VisitBody(visit: visit),
      ),
    );
  }
}

class _VisitBody extends ConsumerWidget {
  const _VisitBody({required this.visit});
  final AgentVisit visit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return RefreshIndicator(
      onRefresh: () => ref.read(visitDetailControllerProvider(visit.id).notifier).refresh(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          Row(
            children: [
              Expanded(child: Text(visit.actualName, style: text.titleLarge)),
              _visitStatusPill(visit),
            ],
          ),
          const SizedBox(height: 2),
          Text('“${visit.alias}” · ${visit.areaLabel}, ${visit.city}', style: text.bodySmall),
          const SizedBox(height: 16),
          AgentCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AgentInfoRow(label: 'Address', value: visit.fullAddress),
                AgentInfoRow(
                  label: 'Coordinates',
                  value: '${visit.latitude.toStringAsFixed(5)}, ${visit.longitude.toStringAsFixed(5)}',
                ),
                AgentInfoRow(label: 'Scheduled', value: DateFormat('EEE d MMM, h:mm a').format(visit.scheduledAt.toLocal())),
                if (visit.notes != null && visit.notes!.trim().isNotEmpty)
                  AgentInfoRow(label: 'Notes', value: visit.notes!),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _CheckInSection(visit: visit),
          const SizedBox(height: 16),
          _InspectionSection(visit: visit),
        ],
      ),
    );
  }
}

Widget _visitStatusPill(AgentVisit visit) {
  if (visit.isCompleted) return const AgentPill(label: 'Completed', color: AppColors.verified);
  if (visit.isCancelled) return const AgentPill(label: 'Cancelled', color: AppColors.faintInk);
  return const AgentPill(label: 'Scheduled', color: AppColors.agentVisited);
}

/// The "Start Visit" GPS check-in. Server owns the within-range verdict.
class _CheckInSection extends ConsumerWidget {
  const _CheckInSection({required this.visit});
  final AgentVisit visit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final phase = ref.watch(checkInControllerProvider(visit.id));

    // The recorded check-in (server truth) drives the persistent status; the phase
    // drives the in-flight UI.
    final existing = visit.checkIn;

    return AgentCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.my_location, size: 18, color: AppColors.agentHeroStart),
              const SizedBox(width: 8),
              Text('GPS check-in', style: text.titleMedium),
            ],
          ),
          const SizedBox(height: 8),
          if (existing != null && existing.withinRange)
            _statusLine(
              icon: Icons.check_circle,
              color: AppColors.verified,
              text: 'Checked in ${_distanceText(existing.distanceM)} — you can start the inspection.',
            )
          else if (existing != null && !existing.withinRange)
            _statusLine(
              icon: Icons.wrong_location,
              color: AppColors.sponsored,
              text: 'Out of range ${_distanceText(existing.distanceM)}. Recorded as “cannot reach property”. '
                  'Move within 200m and check in again to unlock the inspection.',
            )
          else
            Text(
              'Start the visit at the property to capture your GPS check-in. It must be within 200m to '
              'unlock the inspection.',
              style: text.bodySmall,
            ),
          const SizedBox(height: 12),
          _phaseFeedback(context, phase),
          const SizedBox(height: 4),
          _checkInButton(context, ref, phase),
        ],
      ),
    );
  }

  Widget _checkInButton(BuildContext context, WidgetRef ref, CheckInPhase phase) {
    final busy = phase is CheckInLocating || phase is CheckInSubmitting;
    final done = visit.hasValidCheckIn;
    final label = done
        ? 'Check in again'
        : (visit.checkedInOutOfRange ? 'Retry check-in' : 'Start visit');
    if (busy) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 6),
        child: Row(children: [
          SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
          SizedBox(width: 12),
          Text('Getting your location…'),
        ]),
      );
    }
    return PrimaryButton(
      label: label,
      icon: Icons.location_searching,
      expand: true,
      onPressed: () => ref.read(checkInControllerProvider(visit.id).notifier).start(),
    );
  }

  Widget _phaseFeedback(BuildContext context, CheckInPhase phase) {
    return switch (phase) {
      CheckInLocationBlocked(:final failure) => _statusLine(
          icon: Icons.location_disabled,
          color: AppColors.error,
          text: locationFailureMessage(failure),
        ),
      CheckInFailed(:final message) => _statusLine(icon: Icons.error_outline, color: AppColors.error, text: message),
      _ => const SizedBox.shrink(),
    };
  }

  static Widget _statusLine({required IconData icon, required Color color, required String text}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w500))),
      ],
    );
  }

  static String _distanceText(double d) => d >= 1000 ? '(${(d / 1000).toStringAsFixed(1)} km away)' : '(${d.round()} m away)';
}

/// Inspection entry — locked until a valid check-in exists.
class _InspectionSection extends StatelessWidget {
  const _InspectionSection({required this.visit});
  final AgentVisit visit;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final unlocked = visit.hasValidCheckIn;
    return AgentCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(unlocked ? Icons.assignment : Icons.lock_outline,
                  size: 18, color: unlocked ? AppColors.agentHeroStart : AppColors.faintInk),
              const SizedBox(width: 8),
              Text('Inspection', style: text.titleMedium),
              const Spacer(),
              if (visit.inspectionStatus != null) _inspectionPill(visit.inspectionStatus!),
            ],
          ),
          const SizedBox(height: 8),
          if (!unlocked)
            Text(
              'Locked. Complete a valid GPS check-in (within 200m) to start the inspection.',
              style: text.bodySmall,
            )
          else if (visit.inspectionSubmitted)
            Text('Submitted to the admin review queue.', style: text.bodySmall)
          else
            Text('Fill the amenity, room-count, cleanliness and security checks and capture the '
                'geotagged photos, then submit.', style: text.bodySmall),
          const SizedBox(height: 12),
          PrimaryButton(
            label: visit.inspectionSubmitted ? 'View inspection' : 'Open inspection',
            icon: Icons.checklist,
            expand: true,
            onPressed: unlocked ? () => context.go('/agent/visits/${visit.id}/inspection') : null,
          ),
        ],
      ),
    );
  }
}

Widget _inspectionPill(String status) => switch (status) {
      'SUBMITTED' => const AgentPill(label: 'Submitted', color: AppColors.agentVisited),
      'APPROVED' => const AgentPill(label: 'Approved', color: AppColors.verified),
      'REJECTED' => const AgentPill(label: 'Rejected', color: AppColors.error),
      _ => const AgentPill(label: 'Draft', color: AppColors.sponsored),
    };
