import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/rent_providers.dart';
import '../data/rent_repository.dart';
import '../domain/rent_invoice.dart';

/// Rent history: every invoice, newest first, with its status. Unpaid invoices
/// offer Pay Rent; paid invoices offer a downloadable PDF receipt.
class RentScreen extends ConsumerWidget {
  const RentScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(rentInvoicesProvider);
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('Rent')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(rentInvoicesProvider),
        child: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => _Message(message: apiExceptionFrom(e).message),
          data: (page) {
            if (page.items.isEmpty) {
              return const _Message(message: 'No rent invoices yet. Your first month is covered by the token.');
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: page.items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (_, i) => _RentRow(invoice: page.items[i]),
            );
          },
        ),
      ),
    );
  }
}

class _RentRow extends ConsumerWidget {
  const _RentRow({required this.invoice});

  final RentInvoice invoice;

  Future<void> _downloadReceipt(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await ref.read(rentRepositoryProvider).downloadReceipt(invoice.id);
      await Share.shareXFiles([
        XFile.fromData(bytes, mimeType: 'application/pdf', name: 'roomadda-rent-${invoice.id}.pdf'),
      ]);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final (label, color) = _statusVisual(invoice);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadii.cardBorder,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(invoice.periodLabel, style: text.titleMedium)),
                DecoratedBox(
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: AppRadii.pillBorder),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(invoice.amount.format(), style: text.titleLarge),
            const SizedBox(height: 12),
            if (invoice.isUnpaid)
              PrimaryButton(
                label: 'Pay Rent',
                icon: Icons.payments_outlined,
                expand: true,
                onPressed: () => context.push('/tenant/rent/${invoice.id}/pay'),
              )
            else
              SecondaryButton(
                label: 'Download receipt',
                icon: Icons.download,
                expand: true,
                onPressed: () => _downloadReceipt(context, ref),
              ),
          ],
        ),
      ),
    );
  }
}

(String, Color) _statusVisual(RentInvoice inv) {
  if (inv.isPaid) return ('PAID', AppColors.verified);
  if (inv.isOverdue) {
    return ('OVERDUE · ${inv.daysOverdue} ${inv.daysOverdue == 1 ? 'DAY' : 'DAYS'}', AppColors.accent);
  }
  return ('DUE', AppColors.sponsored);
}

class _Message extends StatelessWidget {
  const _Message({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 120),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(message, textAlign: TextAlign.center),
          ),
        ),
      ],
    );
  }
}
