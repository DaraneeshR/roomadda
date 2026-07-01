import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/service_providers.dart';
import '../data/service_repository.dart';
import '../domain/service_request.dart';
import 'service_requests_screen.dart' show ServiceStatusChip;

/// Full request detail: the Submitted → Acknowledged → Resolved tracker, the
/// issue, the comment thread (append-only), and — once resolved — a 1–5 star
/// rating prompt. Status is server-owned; the screen only reads/refetches it.
class ServiceRequestDetailScreen extends ConsumerWidget {
  const ServiceRequestDetailScreen({super.key, required this.requestId});

  final String requestId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(serviceRequestProvider(requestId));
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('Request')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(apiExceptionFrom(e).message)),
        data: (request) => _Detail(request: request),
      ),
    );
  }
}

class _Detail extends ConsumerWidget {
  const _Detail({required this.request});

  final ServiceRequest request;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(
          children: [
            Expanded(child: Text(serviceCategoryLabel(request.category), style: text.titleLarge)),
            ServiceStatusChip(status: request.status),
          ],
        ),
        const SizedBox(height: 4),
        Text(request.ticketNumber, style: AppTypography.priceStyle(fontSize: 14, color: AppColors.mutedInk)),
        if (request.escalated) ...[
          const SizedBox(height: 10),
          const _Banner(text: 'Escalated to RoomAdda admin for priority attention.'),
        ],
        const SizedBox(height: 20),
        _StatusTracker(currentStep: serviceStatusStep(request.status)),
        const SizedBox(height: 20),
        _Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text('ISSUE', style: AppTypography.eyebrow),
                  const Spacer(),
                  if (request.isUrgent)
                    Text('URGENT', style: AppTypography.eyebrow.copyWith(color: AppColors.accent)),
                ],
              ),
              const SizedBox(height: 8),
              Text(request.description, style: text.bodyLarge),
              if (request.photoCount > 0) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Icon(Icons.photo_library_outlined, size: 18, color: AppColors.mutedInk),
                    const SizedBox(width: 6),
                    Text('${request.photoCount} photo${request.photoCount == 1 ? '' : 's'} attached',
                        style: text.bodySmall),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (request.isResolved) _RatingSection(request: request),
        Text('UPDATES', style: AppTypography.eyebrow),
        const SizedBox(height: 8),
        if (request.comments.isEmpty)
          Text('No updates yet.', style: text.bodyMedium?.copyWith(color: AppColors.faintInk))
        else
          for (final c in request.comments) _CommentTile(comment: c),
        const SizedBox(height: 12),
        _CommentComposer(requestId: request.id),
      ],
    );
  }
}

class _StatusTracker extends StatelessWidget {
  const _StatusTracker({required this.currentStep});

  final int currentStep;

  static const _labels = ['Submitted', 'Acknowledged', 'Resolved'];

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var i = 0; i < _labels.length; i++) ...[
          if (i > 0)
            Expanded(
              child: Container(
                height: 2,
                color: i <= currentStep ? AppColors.accent : AppColors.hairlineStrong,
              ),
            ),
          _Node(label: _labels[i], done: i <= currentStep),
        ],
      ],
    );
  }
}

class _Node extends StatelessWidget {
  const _Node({required this.label, required this.done});

  final String label;
  final bool done;

  @override
  Widget build(BuildContext context) {
    final color = done ? AppColors.accent : AppColors.hairlineStrong;
    return Column(
      children: [
        Container(
          width: 26,
          height: 26,
          decoration: BoxDecoration(color: done ? color : AppColors.card, shape: BoxShape.circle, border: Border.all(color: color, width: 2)),
          child: done ? const Icon(Icons.check, size: 16, color: AppColors.onAccent) : null,
        ),
        const SizedBox(height: 6),
        SizedBox(
          width: 76,
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11, color: done ? AppColors.ink : AppColors.faintInk, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}

/// 1–5 star rating, shown once a request is resolved. Read-only after submission.
class _RatingSection extends ConsumerStatefulWidget {
  const _RatingSection({required this.request});

  final ServiceRequest request;

  @override
  ConsumerState<_RatingSection> createState() => _RatingSectionState();
}

class _RatingSectionState extends ConsumerState<_RatingSection> {
  int _selected = 0;
  bool _saving = false;

  Future<void> _submit() async {
    if (_selected < 1) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _saving = true);
    try {
      await ref.read(serviceRepositoryProvider).rate(widget.request.id, _selected);
      ref.invalidate(serviceRequestProvider(widget.request.id));
      messenger.showSnackBar(const SnackBar(content: Text('Thanks for your feedback!')));
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final rated = widget.request.rating;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: _Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(rated != null ? 'YOUR RATING' : 'RATE THE RESOLUTION', style: AppTypography.eyebrow),
            const SizedBox(height: 8),
            if (rated != null)
              _Stars(value: rated, onTap: null)
            else ...[
              Text('How was this resolved?', style: text.bodyMedium),
              const SizedBox(height: 8),
              _Stars(value: _selected, onTap: _saving ? null : (v) => setState(() => _selected = v)),
              const SizedBox(height: 12),
              if (_saving)
                const Center(child: CircularProgressIndicator())
              else
                PrimaryButton(label: 'Submit rating', expand: true, onPressed: _selected > 0 ? _submit : null),
            ],
          ],
        ),
      ),
    );
  }
}

class _Stars extends StatelessWidget {
  const _Stars({required this.value, required this.onTap});

  final int value;
  final ValueChanged<int>? onTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var i = 1; i <= 5; i++)
          IconButton(
            onPressed: onTap == null ? null : () => onTap!(i),
            icon: Icon(
              i <= value ? Icons.star : Icons.star_border,
              color: AppColors.sponsored,
              size: 30,
            ),
          ),
      ],
    );
  }
}

class _CommentComposer extends ConsumerStatefulWidget {
  const _CommentComposer({required this.requestId});

  final String requestId;

  @override
  ConsumerState<_CommentComposer> createState() => _CommentComposerState();
}

class _CommentComposerState extends ConsumerState<_CommentComposer> {
  final _controller = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final body = _controller.text.trim();
    if (body.isEmpty || _sending) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _sending = true);
    try {
      await ref.read(serviceRepositoryProvider).addComment(widget.requestId, body);
      _controller.clear();
      ref.invalidate(serviceRequestProvider(widget.requestId));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: TextField(
            controller: _controller,
            minLines: 1,
            maxLines: 4,
            enabled: !_sending,
            decoration: InputDecoration(
              hintText: 'Add an update…',
              filled: true,
              fillColor: AppColors.card,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
            ),
          ),
        ),
        const SizedBox(width: 8),
        IconButton.filled(
          onPressed: _sending ? null : _send,
          icon: const Icon(Icons.send),
          style: IconButton.styleFrom(backgroundColor: AppColors.accent, foregroundColor: AppColors.onAccent),
        ),
      ],
    );
  }
}

class _CommentTile extends StatelessWidget {
  const _CommentTile({required this.comment});

  final ServiceRequestComment comment;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: _Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(comment.authorName, style: text.titleSmall),
                const SizedBox(width: 6),
                Text('· ${comment.authorRole.toLowerCase()}', style: text.bodySmall?.copyWith(color: AppColors.faintInk)),
              ],
            ),
            const SizedBox(height: 4),
            Text(comment.body, style: text.bodyMedium),
          ],
        ),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadii.cardBorder,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Padding(padding: const EdgeInsets.all(16), child: child),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(color: AppColors.accentWash, borderRadius: AppRadii.inputBorder),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.priority_high, size: 18, color: AppColors.accent),
            const SizedBox(width: 8),
            Expanded(child: Text(text, style: const TextStyle(color: AppColors.accent, fontSize: 13))),
          ],
        ),
      ),
    );
  }
}
