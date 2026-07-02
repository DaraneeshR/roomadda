import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/agent_async.dart';
import '../../common/agent_widgets.dart';
import '../../visits/application/visit_providers.dart';
import '../application/inspection_controller.dart';
import '../domain/inspection.dart';

/// The property inspection checklist: amenity Yes/No/Partial, room-count actual vs
/// listed, cleanliness 1–5 per area, security infra, discrepancies, a
/// recommendation, and the ≥8 geotagged photos. Partial-save/resume on the same
/// visit; submit routes to the admin queue. The whole screen is LOCKED until the
/// visit has a valid GPS check-in — the same gate the backend enforces.
class InspectionScreen extends ConsumerStatefulWidget {
  const InspectionScreen({super.key, required this.visitId});
  final String visitId;

  @override
  ConsumerState<InspectionScreen> createState() => _InspectionScreenState();
}

class _InspectionScreenState extends ConsumerState<InspectionScreen> {
  final _listed = TextEditingController();
  final _actual = TextEditingController();
  final _discrepancies = TextEditingController();
  final _notes = TextEditingController();
  bool _seeded = false;

  @override
  void dispose() {
    _listed.dispose();
    _actual.dispose();
    _discrepancies.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _seedControllers(InspectionEditState s) {
    if (_seeded) return;
    _seeded = true;
    _listed.text = s.roomCountListed?.toString() ?? '';
    _actual.text = s.roomCountActual?.toString() ?? '';
    _discrepancies.text = s.discrepancies;
    _notes.text = s.notesForAdmin;
  }

  @override
  Widget build(BuildContext context) {
    final visitId = widget.visitId;
    final notifier = ref.read(inspectionControllerProvider(visitId).notifier);
    final state = ref.watch(inspectionControllerProvider(visitId));
    final hasValidCheckIn = ref.watch(
      visitDetailControllerProvider(visitId).select((v) => v.data?.hasValidCheckIn ?? false),
    );

    // Surface transient notices (save/capture/submit) as snackbars.
    ref.listen(inspectionControllerProvider(visitId).select((s) => s.notice), (_, notice) {
      if (notice != null && notice.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(notice)));
      }
    });
    // On successful submit, return to the visit (its inspection status refreshes).
    ref.listen(inspectionControllerProvider(visitId).select((s) => s.submitted), (_, submitted) {
      if (submitted) {
        ref.read(visitDetailControllerProvider(visitId).notifier).refresh();
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Inspection submitted to the admin queue.')));
        if (context.canPop()) context.pop();
      }
    });

    if (!state.loading && state.loadError == null) _seedControllers(state);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inspection'),
        actions: [
          if (!state.locked)
            TextButton(
              onPressed: state.saving ? null : () => notifier.saveDraft(),
              child: state.saving
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Save'),
            ),
        ],
      ),
      body: Builder(builder: (context) {
        if (state.loading) return const SkeletonList(count: 5, height: 72);
        if (state.loadError != null) {
          return AgentErrorRetry(message: state.loadError!, onRetry: () async => notifier.load());
        }
        if (!hasValidCheckIn && !state.locked) return const _LockedGate();
        return _InspectionForm(
          visitId: visitId,
          state: state,
          hasValidCheckIn: hasValidCheckIn,
          listed: _listed,
          actual: _actual,
          discrepancies: _discrepancies,
          notes: _notes,
        );
      }),
    );
  }
}

/// Shown if the inspection is somehow opened without a valid check-in.
class _LockedGate extends StatelessWidget {
  const _LockedGate();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.lock_outline, size: 44, color: AppColors.faintInk),
            const SizedBox(height: 12),
            const Text(
              'Inspection locked. Complete a valid GPS check-in (within 200m) on the visit first.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.mutedInk),
            ),
            const SizedBox(height: 16),
            SecondaryButton(label: 'Back to visit', icon: Icons.arrow_back, onPressed: () => context.pop()),
          ],
        ),
      ),
    );
  }
}

class _InspectionForm extends ConsumerWidget {
  const _InspectionForm({
    required this.visitId,
    required this.state,
    required this.hasValidCheckIn,
    required this.listed,
    required this.actual,
    required this.discrepancies,
    required this.notes,
  });

  final String visitId;
  final InspectionEditState state;
  final bool hasValidCheckIn;
  final TextEditingController listed;
  final TextEditingController actual;
  final TextEditingController discrepancies;
  final TextEditingController notes;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(inspectionControllerProvider(visitId).notifier);
    final locked = state.locked;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        if (locked)
          const AgentCard(
            child: Row(children: [
              Icon(Icons.check_circle, color: AppColors.agentVisited, size: 18),
              SizedBox(width: 8),
              Expanded(child: Text('Submitted — this inspection is now locked and in the admin review queue.')),
            ]),
          ),
        if (locked) const SizedBox(height: 16),

        // ---- Photos --------------------------------------------------------
        _PhotoSection(visitId: visitId, state: state, locked: locked),
        const SizedBox(height: 16),

        // ---- Room count ----------------------------------------------------
        _Card(
          title: 'Room count',
          child: Row(
            children: [
              Expanded(
                child: _NumberField(
                  label: 'Listed',
                  controller: listed,
                  enabled: !locked,
                  onChanged: (v) => notifier.setRoomCountListed(int.tryParse(v)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _NumberField(
                  label: 'Actual',
                  controller: actual,
                  enabled: !locked,
                  onChanged: (v) => notifier.setRoomCountActual(int.tryParse(v)),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ---- Amenities -----------------------------------------------------
        _Card(
          title: 'Amenities',
          child: Column(
            children: [
              for (final name in InspectionChecklist.amenities)
                _AmenityRow(
                  name: name,
                  value: state.amenities[name],
                  enabled: !locked,
                  onChanged: (v) => notifier.setAmenity(name, v),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ---- Cleanliness ---------------------------------------------------
        _Card(
          title: 'Cleanliness (1–5)',
          child: Column(
            children: [
              for (final area in InspectionChecklist.cleanlinessAreas)
                _CleanlinessRow(
                  area: area,
                  value: state.cleanliness[area],
                  enabled: !locked,
                  onChanged: (v) => notifier.setCleanliness(area, v),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ---- Security ------------------------------------------------------
        _Card(
          title: 'Security infrastructure',
          child: Column(
            children: [
              for (final item in InspectionChecklist.securityItems)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(item),
                  value: state.securityInfra[item] ?? false,
                  onChanged: locked ? null : (v) => notifier.setSecurity(item, v),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ---- Discrepancies -------------------------------------------------
        _Card(
          title: 'Discrepancies',
          child: TextField(
            controller: discrepancies,
            enabled: !locked,
            maxLines: 3,
            decoration: const InputDecoration(hintText: 'Anything that differs from the listing…'),
            onChanged: notifier.setDiscrepancies,
          ),
        ),
        const SizedBox(height: 16),

        // ---- Recommendation ------------------------------------------------
        _Card(
          title: 'Recommendation',
          child: Wrap(
            spacing: 8,
            children: [
              for (final r in InspectionRecommendation.values)
                ChoiceChip(
                  label: Text(r.label),
                  selected: state.recommendation == r,
                  onSelected: locked ? null : (_) => notifier.setRecommendation(r),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ---- Notes for admin ----------------------------------------------
        _Card(
          title: 'Notes for admin (optional)',
          child: TextField(
            controller: notes,
            enabled: !locked,
            maxLines: 3,
            decoration: const InputDecoration(hintText: 'Context for the reviewer…'),
            onChanged: notifier.setNotes,
          ),
        ),
        const SizedBox(height: 24),

        if (!locked) _SubmitBlock(visitId: visitId, state: state, hasValidCheckIn: hasValidCheckIn),
      ],
    );
  }
}

class _SubmitBlock extends ConsumerWidget {
  const _SubmitBlock({required this.visitId, required this.state, required this.hasValidCheckIn});
  final String visitId;
  final InspectionEditState state;
  final bool hasValidCheckIn;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final canSubmit = state.canSubmit(hasValidCheckIn);
    final blockers = state.submitBlockers(hasValidCheckIn);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!canSubmit)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final b in blockers)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Row(children: [
                      const Icon(Icons.info_outline, size: 14, color: AppColors.sponsored),
                      const SizedBox(width: 6),
                      Expanded(child: Text(b, style: const TextStyle(color: AppColors.mutedInk, fontSize: 13))),
                    ]),
                  ),
              ],
            ),
          ),
        if (state.submitting)
          const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator()))
        else
          PrimaryButton(
            label: 'Submit to admin',
            icon: Icons.send,
            expand: true,
            onPressed: canSubmit ? () => ref.read(inspectionControllerProvider(visitId).notifier).submit(hasValidCheckIn: hasValidCheckIn) : null,
          ),
      ],
    );
  }
}

class _PhotoSection extends ConsumerWidget {
  const _PhotoSection({required this.visitId, required this.state, required this.locked});
  final String visitId;
  final InspectionEditState state;
  final bool locked;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final photos = state.inspection?.photos ?? const [];
    final enough = photos.length >= kMinInspectionPhotos;
    return _Card(
      title: 'Photos (${photos.length} of $kMinInspectionPhotos)',
      trailing: enough
          ? const AgentPill(label: 'Enough', color: AppColors.verified)
          : AgentPill(label: '${kMinInspectionPhotos - photos.length} more', color: AppColors.sponsored),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Capture geotagged photos of every area. Each photo records your GPS position and time.',
            style: TextStyle(color: AppColors.mutedInk, fontSize: 13),
          ),
          const SizedBox(height: 12),
          if (photos.isNotEmpty)
            ...photos.map((p) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      const Icon(Icons.photo_camera_back, size: 16, color: AppColors.agentVisited),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${p.lat.toStringAsFixed(5)}, ${p.lng.toStringAsFixed(5)} · ${DateFormat('h:mm a').format(p.takenAt.toLocal())}',
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                )),
          const SizedBox(height: 8),
          if (!locked)
            state.capturing
                ? const Row(children: [
                    SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                    SizedBox(width: 12),
                    Text('Capturing + geotagging…'),
                  ])
                : SecondaryButton(
                    label: 'Capture photo',
                    icon: Icons.photo_camera,
                    expand: true,
                    onPressed: () => ref.read(inspectionControllerProvider(visitId).notifier).capturePhoto(),
                  ),
        ],
      ),
    );
  }
}

// ---- Small building blocks -------------------------------------------------

class _Card extends StatelessWidget {
  const _Card({required this.title, required this.child, this.trailing});
  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return AgentCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium)),
            if (trailing != null) trailing!,
          ]),
          const SizedBox(height: 8),
          child,
        ],
      ),
    );
  }
}

class _NumberField extends StatelessWidget {
  const _NumberField({required this.label, required this.controller, required this.enabled, required this.onChanged});
  final String label;
  final TextEditingController controller;
  final bool enabled;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: InputDecoration(labelText: label),
      onChanged: onChanged,
    );
  }
}

class _AmenityRow extends StatelessWidget {
  const _AmenityRow({required this.name, required this.value, required this.enabled, required this.onChanged});
  final String name;
  final AmenityCheck? value;
  final bool enabled;
  final ValueChanged<AmenityCheck> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(name)),
          Wrap(
            spacing: 6,
            children: [
              for (final v in AmenityCheck.values)
                ChoiceChip(
                  label: Text(v.label),
                  visualDensity: VisualDensity.compact,
                  selected: value == v,
                  onSelected: enabled ? (_) => onChanged(v) : null,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CleanlinessRow extends StatelessWidget {
  const _CleanlinessRow({required this.area, required this.value, required this.enabled, required this.onChanged});
  final String area;
  final int? value;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(area)),
          for (var i = 1; i <= 5; i++)
            IconButton(
              visualDensity: VisualDensity.compact,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              padding: EdgeInsets.zero,
              icon: Icon(
                (value ?? 0) >= i ? Icons.star : Icons.star_border,
                size: 22,
                color: (value ?? 0) >= i ? AppColors.sponsored : AppColors.faintInk,
              ),
              onPressed: enabled ? () => onChanged(i) : null,
            ),
        ],
      ),
    );
  }
}
