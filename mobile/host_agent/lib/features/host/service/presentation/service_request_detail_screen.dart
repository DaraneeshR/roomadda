import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/service_providers.dart';
import '../data/host_service_repository.dart';
import '../domain/host_service_request.dart';
import 'service_queue_screen.dart';

/// One service request: the ticket, its note/comment thread, and the host actions
/// — acknowledge (when submitted), add a tenant-visible note, resolve. No delete.
/// Only the tenant's name and room are shown — never KYC.
class ServiceRequestDetailScreen extends ConsumerWidget {
  const ServiceRequestDetailScreen({super.key, required this.requestId});
  final String requestId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(serviceRequestProvider(requestId));
    return Scaffold(
      appBar: AppBar(title: const Text('Service request')),
      body: HostAsync<HostServiceRequest>(
        value: async,
        onRetry: () => ref.invalidate(serviceRequestProvider(requestId)),
        skeleton: const SkeletonList(count: 3, height: 120),
        data: (r) => _Body(request: r),
      ),
    );
  }
}

class _Body extends ConsumerStatefulWidget {
  const _Body({required this.request});
  final HostServiceRequest request;

  @override
  ConsumerState<_Body> createState() => _BodyState();
}

class _BodyState extends ConsumerState<_Body> {
  bool _busy = false;

  Future<void> _run(Future<HostServiceRequest> Function(HostServiceRepository repo) action, String okMsg) async {
    setState(() => _busy = true);
    try {
      await action(ref.read(hostServiceRepositoryProvider));
      ref.invalidate(serviceRequestProvider(widget.request.id));
      ref.invalidate(serviceQueueProvider);
      ref.invalidate(hostDashboardProvider);
      if (mounted) _snack(okMsg);
    } catch (e) {
      if (mounted) _snack(apiExceptionFrom(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _addNote() async {
    final note = await _askNote();
    if (note == null || note.isEmpty) return;
    await _run((r) => r.addNote(widget.request.id, note), 'Note added — tenant notified');
  }

  Future<String?> _askNote() {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add a note'),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(hintText: 'Visible to the tenant'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(ctx).pop(controller.text.trim()), child: const Text('Add')),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.request;
    final text = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      children: [
        Row(
          children: [
            Expanded(child: Text(serviceCategoryLabel(r.category), style: text.headlineSmall)),
            ServiceStatusPill(status: r.status),
          ],
        ),
        const SizedBox(height: 4),
        Text(r.ticketNumber, style: AppTypography.priceStyle(fontSize: 13, color: AppColors.mutedInk)),
        if (r.escalated || r.isUrgent) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              if (r.escalated) const HostPill(label: 'Escalated', color: AppColors.accent),
              if (r.escalated && r.isUrgent) const SizedBox(width: 6),
              if (r.isUrgent) const HostPill(label: 'Urgent', color: AppColors.sponsored),
            ],
          ),
        ],
        const SizedBox(height: 16),
        HostCard(
          child: Column(
            children: [
              InfoRow(label: 'Tenant', value: r.tenantName),
              if (r.roomName != null) InfoRow(label: 'Room', value: r.roomName!),
              InfoRow(label: 'Raised', value: DateFormat.yMMMd().add_jm().format(r.createdAt)),
              if (r.photoCount > 0) InfoRow(label: 'Photos', value: '${r.photoCount} attached'),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Text('Description', style: AppTypography.eyebrow),
        const SizedBox(height: 6),
        Text(r.description, style: text.bodyLarge),
        const SizedBox(height: 20),
        if (r.comments.isNotEmpty) ...[
          Text('Activity', style: AppTypography.eyebrow),
          const SizedBox(height: 8),
          for (final c in r.comments) _CommentBubble(comment: c),
          const SizedBox(height: 12),
        ],
        if (_busy)
          const Center(child: CircularProgressIndicator())
        else
          _Actions(request: r, onAcknowledge: () => _run((repo) => repo.acknowledge(r.id), 'Acknowledged'), onNote: _addNote, onResolve: () => _run((repo) => repo.resolve(r.id), 'Marked resolved')),
      ],
    );
  }
}

class _Actions extends StatelessWidget {
  const _Actions({
    required this.request,
    required this.onAcknowledge,
    required this.onNote,
    required this.onResolve,
  });

  final HostServiceRequest request;
  final VoidCallback onAcknowledge;
  final VoidCallback onNote;
  final VoidCallback onResolve;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (request.canAcknowledge)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: PrimaryButton(label: 'Acknowledge', icon: Icons.visibility_outlined, expand: true, onPressed: onAcknowledge),
          ),
        Row(
          children: [
            Expanded(child: SecondaryButton(label: 'Add note', icon: Icons.note_add_outlined, expand: true, onPressed: onNote)),
            if (request.canResolve) ...[
              const SizedBox(width: 12),
              Expanded(
                child: PrimaryButton(label: 'Resolve', icon: Icons.check_circle_outline, expand: true, onPressed: onResolve),
              ),
            ],
          ],
        ),
      ],
    );
  }
}

class _CommentBubble extends StatelessWidget {
  const _CommentBubble({required this.comment});
  final ServiceComment comment;

  @override
  Widget build(BuildContext context) {
    final isHost = comment.authorRole == 'HOST' || comment.authorRole == 'ADMIN';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isHost ? AppColors.accentWash : AppColors.paperAlt,
        borderRadius: AppRadii.cardBorder,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(comment.authorName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              const SizedBox(width: 8),
              Text(DateFormat.MMMd().add_jm().format(comment.createdAt), style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
          const SizedBox(height: 4),
          Text(comment.body),
        ],
      ),
    );
  }
}
