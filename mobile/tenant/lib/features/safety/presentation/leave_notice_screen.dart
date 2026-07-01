import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/safety_providers.dart';
import '../data/leave_notice_repository.dart';
import '../domain/leave_notice.dart';

/// Serve / track a notice to vacate. The earliest selectable move-out comes from
/// the server's policy (notice period); the 3-day withdraw lock is enforced
/// server-side and reflected by `canWithdraw`.
class LeaveNoticeScreen extends ConsumerWidget {
  const LeaveNoticeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(leaveNoticeProvider);
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('Leave notice')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(apiExceptionFrom(e).message)),
        data: (view) {
          final active = view.active;
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (active != null)
                _ActiveNotice(notice: active)
              else
                _NoticeForm(view: view),
            ],
          );
        },
      ),
    );
  }
}

class _ActiveNotice extends ConsumerWidget {
  const _ActiveNotice({required this.notice});

  final LeaveNotice notice;

  Future<void> _withdraw(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Withdraw notice?'),
        content: const Text('Your stay continues as normal and the bed is no longer marked vacating.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep notice')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Withdraw')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(leaveNoticeRepositoryProvider).withdraw(notice.id);
      ref.invalidate(leaveNoticeProvider);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(color: AppColors.card, borderRadius: AppRadii.cardBorder, border: Border.all(color: AppColors.hairline)),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('NOTICE ACTIVE', style: AppTypography.eyebrow.copyWith(color: AppColors.verified)),
                const SizedBox(height: 8),
                Text('Moving out on', style: text.bodyMedium?.copyWith(color: AppColors.mutedInk)),
                Text(_fmtDate(notice.moveOutDate), style: text.headlineSmall),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        if (notice.canWithdraw)
          SecondaryButton(label: 'Withdraw notice', icon: Icons.undo, expand: true, onPressed: () => _withdraw(context, ref))
        else
          Text(
            'This notice can no longer be withdrawn (within 3 days of move-out).',
            style: text.bodySmall?.copyWith(color: AppColors.faintInk),
            textAlign: TextAlign.center,
          ),
      ],
    );
  }
}

class _NoticeForm extends ConsumerStatefulWidget {
  const _NoticeForm({required this.view});

  final LeaveNoticeView view;

  @override
  ConsumerState<_NoticeForm> createState() => _NoticeFormState();
}

class _NoticeFormState extends ConsumerState<_NoticeForm> {
  DateTime? _selected;
  bool _saving = false;
  String? _error;

  Future<void> _pickDate() async {
    final earliest = widget.view.earliestMoveOutDate;
    final picked = await showDatePicker(
      context: context,
      initialDate: _selected ?? earliest,
      firstDate: earliest, // server policy: at least the notice period out
      lastDate: earliest.add(const Duration(days: 365)),
      helpText: 'Select your move-out date',
    );
    if (picked != null) setState(() => _selected = picked);
  }

  Future<void> _submit() async {
    final date = _selected;
    if (date == null) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(leaveNoticeRepositoryProvider).submit(date);
      ref.invalidate(leaveNoticeProvider);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = apiExceptionFrom(e).message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Serve notice to vacate', style: text.titleLarge),
        const SizedBox(height: 8),
        Text(
          'A ${widget.view.noticePeriodDays}-day notice period applies, so the earliest move-out is '
          '${_fmtDate(widget.view.earliestMoveOutDate)}.',
          style: text.bodyMedium?.copyWith(color: AppColors.mutedInk),
        ),
        const SizedBox(height: 20),
        Text('MOVE-OUT DATE', style: AppTypography.eyebrow),
        const SizedBox(height: 8),
        InkWell(
          onTap: _saving ? null : _pickDate,
          borderRadius: AppRadii.inputBorder,
          child: InputDecorator(
            decoration: const InputDecoration(border: OutlineInputBorder(), suffixIcon: Icon(Icons.calendar_today)),
            child: Text(
              _selected == null ? 'Select a date' : _fmtDate(_selected!),
              style: TextStyle(color: _selected == null ? AppColors.faintInk : AppColors.ink),
            ),
          ),
        ),
        const SizedBox(height: 24),
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(color: AppColors.accent)),
          const SizedBox(height: 12),
        ],
        if (_saving)
          const Center(child: CircularProgressIndicator())
        else
          PrimaryButton(label: 'Serve notice', icon: Icons.event_available, expand: true, onPressed: _selected == null ? null : _submit),
      ],
    );
  }
}

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _fmtDate(DateTime d) => '${d.day} ${_months[d.month - 1]} ${d.year}';
