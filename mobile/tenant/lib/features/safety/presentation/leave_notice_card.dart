import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/safety_providers.dart';

/// Dashboard card: shows the leave-notice status (active move-out date) or a
/// "Serve notice" entry point. Tapping opens the leave-notice screen.
class LeaveNoticeCard extends ConsumerWidget {
  const LeaveNoticeCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(leaveNoticeProvider);
    final text = Theme.of(context).textTheme;

    return Material(
      color: AppColors.card,
      borderRadius: AppRadii.cardBorder,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/tenant/leave-notice'),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: AppRadii.cardBorder,
            border: Border.all(color: AppColors.hairline),
          ),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Row(
              children: [
                Expanded(
                  child: async.maybeWhen(
                    data: (view) {
                      final active = view.active;
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('LEAVE NOTICE', style: AppTypography.eyebrow),
                          const SizedBox(height: 6),
                          if (active != null)
                            Text('Moving out ${_fmtDate(active.moveOutDate)}', style: text.titleMedium)
                          else
                            Text('Planning to move out? Serve notice.', style: text.titleMedium),
                        ],
                      );
                    },
                    orElse: () => Row(
                      children: [
                        Text('LEAVE NOTICE', style: AppTypography.eyebrow),
                        const SizedBox(width: 12),
                        Text('Serve notice', style: text.bodyMedium?.copyWith(color: AppColors.mutedInk)),
                      ],
                    ),
                  ),
                ),
                const Icon(Icons.chevron_right, color: AppColors.mutedInk),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _fmtDate(DateTime d) => '${d.day} ${_months[d.month - 1]} ${d.year}';
