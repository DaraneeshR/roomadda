import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/rent_providers.dart';
import '../domain/rent_invoice.dart';

/// The dashboard's rent card: surfaces the current invoice as Paid / Due /
/// Overdue (overdue shown in red with the days late) and offers Pay Rent for an
/// unpaid invoice. Payment is webhook-confirmed on the next screen — this card
/// only reads server state (RENT IS MONEY; see /CLAUDE.md).
class RentCard extends ConsumerWidget {
  const RentCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(rentInvoicesProvider);
    return async.when(
      loading: () => const _RentShell(child: _RentLine(label: 'Loading your rent…')),
      // Never break the dashboard on a rent read error — stay quiet.
      error: (_, __) => const SizedBox.shrink(),
      data: (page) {
        final invoice = currentRentInvoice(page.items);
        if (invoice == null) {
          return const _RentShell(child: _RentLine(label: "You're all set — no rent due yet."));
        }
        return _RentContent(invoice: invoice);
      },
    );
  }
}

class _RentContent extends StatelessWidget {
  const _RentContent({required this.invoice});

  final RentInvoice invoice;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final overdue = invoice.isOverdue;
    final paid = invoice.isPaid;

    final (String statusLabel, Color statusColor) = paid
        ? ('PAID', AppColors.verified)
        : overdue
            ? ('OVERDUE · ${invoice.daysOverdue} ${invoice.daysOverdue == 1 ? 'DAY' : 'DAYS'}', AppColors.accent)
            : ('DUE', AppColors.sponsored);

    return _RentShell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('RENT · ${invoice.periodLabel}', style: AppTypography.eyebrow)),
              _StatusPill(label: statusLabel, color: statusColor),
            ],
          ),
          const SizedBox(height: 10),
          Text(invoice.amount.format(), style: text.headlineSmall),
          const SizedBox(height: 4),
          Text(
            paid
                ? 'Paid on ${_fmtDate(invoice.paidAt ?? invoice.dueDate)}'
                : overdue
                    ? 'Was due ${_fmtDate(invoice.dueDate)}'
                    : 'Due by ${_fmtDate(invoice.dueDate)}',
            style: text.bodyMedium?.copyWith(color: overdue ? AppColors.accent : AppColors.mutedInk),
          ),
          const SizedBox(height: 14),
          if (invoice.isUnpaid)
            PrimaryButton(
              label: 'Pay Rent',
              icon: Icons.payments_outlined,
              expand: true,
              onPressed: () => context.push('/tenant/rent/${invoice.id}/pay'),
            )
          else
            SecondaryButton(
              label: 'View rent history',
              icon: Icons.receipt_long_outlined,
              expand: true,
              onPressed: () => context.push('/tenant/rent'),
            ),
        ],
      ),
    );
  }
}

class _RentShell extends StatelessWidget {
  const _RentShell({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadii.cardBorder,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Padding(padding: const EdgeInsets.all(20), child: child),
    );
  }
}

class _RentLine extends StatelessWidget {
  const _RentLine({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text('RENT', style: AppTypography.eyebrow),
        const SizedBox(width: 12),
        Expanded(
          child: Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.mutedInk)),
        ),
      ],
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: AppRadii.pillBorder),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
      ),
    );
  }
}

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _fmtDate(DateTime d) => '${d.day} ${_months[d.month - 1]} ${d.year}';
